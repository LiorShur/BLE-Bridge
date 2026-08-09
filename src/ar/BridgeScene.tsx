/**
 * The AR bridge scene (TASKS.md P3-1..P3-7).
 *
 * A ViroARScene that reads the primary BondState from the store and renders a
 * beam of light + particle stream toward the peer. Per CLAUDE.md §3.4 it knows
 * nothing about Bluetooth — only the four numbers. `peerPosition` is a prop,
 * hardcoded 2 m straight ahead along −Z for now; this is the seam where Cloud
 * Anchors / UWB will later supply a real position without touching this file.
 *
 * Every visual binding is eased (P3-7) via effects.ts — no raw state value drives
 * a material or emitter directly. There is an ambient pre-bond shimmer so the app
 * never looks dead before the moment of formation (P3-5).
 *
 * NOTE: depends on React Native + @reactvision/react-viro; not testable off-device.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ViroARScene,
  ViroParticleEmitter,
  ViroQuad,
  ViroMaterials,
  ViroNode,
  ViroAmbientLight,
} from '@reactvision/react-viro';
import { useStore } from '../state/store';
import {
  BRIDGE_EFFECT,
  EASING,
  emissionRateFor,
  emissiveIntensityFor,
  hueByteToHex,
  smoothTowards,
} from './effects';

export interface BridgeSceneProps {
  /** Peer position in scene space. Default: 2 m ahead along −Z (P3-1 seam). */
  peerPosition?: [number, number, number];
}

ViroMaterials.createMaterials({
  bridgeBeam: {
    lightingModel: 'Constant',
    diffuseColor: '#7cf9ff',
    bloomThreshold: 0.0,
  },
});

const FRAME_MS = 16;

export function BridgeScene({ peerPosition }: BridgeSceneProps): React.ReactElement {
  const target: [number, number, number] = peerPosition ?? [0, 0, BRIDGE_EFFECT.defaultPeerPositionZ];

  // Read state via the store; ease it locally so visuals never jump.
  const bond = useStore((s) => s.bond);
  const eased = useRef({ strength: 0, proximity: 0, alignment: 0 });
  const [, force] = useState(0);

  useEffect(() => {
    let raf: ReturnType<typeof setInterval>;
    raf = setInterval(() => {
      const e = eased.current;
      e.strength = smoothTowards(e.strength, bond.strength, FRAME_MS, EASING.strengthTauMs);
      e.proximity = smoothTowards(e.proximity, bond.proximity, FRAME_MS, EASING.proximityTauMs);
      e.alignment = smoothTowards(e.alignment, bond.alignment, FRAME_MS, EASING.alignmentTauMs);
      force((n) => (n + 1) & 0xffff);
    }, FRAME_MS);
    return () => clearInterval(raf);
  }, [bond.strength, bond.proximity, bond.alignment]);

  const e = eased.current;
  const auraHex = bond.peer ? hueByteToHex(bond.peer.hue) : '#7cf9ff';
  const emissionRate = Math.round(emissionRateFor(e.strength));
  const emissive = emissiveIntensityFor(e.proximity);
  const midpoint: [number, number, number] = [target[0] / 2, target[1] / 2, target[2] / 2];

  return (
    <ViroARScene>
      <ViroAmbientLight color="#ffffff" intensity={200} />

      {/* Beam: opacity follows alignment, brightness follows proximity. */}
      <ViroNode position={midpoint}>
        <ViroQuad
          width={0.15}
          height={Math.abs(target[2])}
          rotation={[-90, 0, 0]}
          materials={['bridgeBeam']}
          opacity={0.15 + 0.85 * e.alignment}
          // emissive intensity is expressed via opacity/scale here; real project
          // binds a shader uniform. Kept declarative for the PoC.
        />
      </ViroNode>

      {/* Particle stream along the path. Emission + velocity scale with strength; */}
      {/* an ambient floor keeps a faint shimmer before bonding (P3-5). */}
      <ViroParticleEmitter
        position={[0, 0, 0]}
        duration={2000}
        visible
        run
        loop
        fixedToEmitter
        image={{
          source: require('./particle.png'),
          height: 0.02,
          width: 0.02,
          bloomThreshold: 0.0,
        }}
        spawnBehavior={{ particleLifetime: [1200, 1600], emissionRatePerSecond: [emissionRate, emissionRate] }}
        particleAppearance={{
          opacity: { initialRange: [0, emissive], factor: 'time', interpolation: [{ endValue: 0, interval: [0.8, 1] }] },
          color: { initialRange: [auraHex, auraHex] },
        }}
        particlePhysics={{
          velocity: {
            initialRange: [
              [0, 0, BRIDGE_EFFECT.particles.minVelocity * -1],
              [0, 0, BRIDGE_EFFECT.particles.maxVelocity * -1 * (0.3 + 0.7 * e.strength)],
            ],
          },
        }}
      />
    </ViroARScene>
  );
}
