/**
 * The AR bridge scene — MINIMAL first (TASKS.md P0-3 gate).
 *
 * This is deliberately the simplest thing that proves Viro AR runs on-device: a
 * ViroARScene + ambient light + a single beam box straight ahead along −Z, whose
 * opacity/length track the bond. NO particle emitter and NO custom texture yet —
 * those (and the aura hue, formation burst, multi-peer) are layered back on only
 * once this renders, because the particle system / an odd texture are the most
 * likely native-renderer crash and must be isolated first.
 *
 * Reads only BondState (CLAUDE.md §3.4). `peerPosition` stays the Cloud
 * Anchors/UWB seam. Bindings eased via effects.ts (P3-7).
 *
 * NOTE: depends on React Native + @reactvision/react-viro; not testable off-device.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ViroARScene, ViroBox, ViroMaterials, ViroNode, ViroAmbientLight } from '@reactvision/react-viro';
import { useStore } from '../state/store';
import { BRIDGE_EFFECT, EASING, clamp01, smoothTowards } from './effects';

export interface BridgeSceneProps {
  /** Peer position in scene space. Default: 2 m ahead along −Z (P3-1 seam). */
  peerPosition?: [number, number, number];
}

ViroMaterials.createMaterials({
  bridgeBeam: {
    lightingModel: 'Constant',
    diffuseColor: '#7cf9ff',
  },
});

const FRAME_MS = 16;

export function BridgeScene({ peerPosition }: BridgeSceneProps): React.ReactElement {
  const targetZ = peerPosition ? peerPosition[2] : BRIDGE_EFFECT.defaultPeerPositionZ;

  const bond = useStore((s) => s.bond);
  const eased = useRef({ strength: 0, proximity: 0, alignment: 0 });
  const [, force] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      const e = eased.current;
      e.strength = smoothTowards(e.strength, bond.strength, FRAME_MS, EASING.strengthTauMs);
      e.proximity = smoothTowards(e.proximity, bond.proximity, FRAME_MS, EASING.proximityTauMs);
      e.alignment = smoothTowards(e.alignment, bond.alignment, FRAME_MS, EASING.alignmentTauMs);
      force((n) => (n + 1) & 0xffff);
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [bond.strength, bond.proximity, bond.alignment]);

  const e = eased.current;
  // Beam length grows toward the peer with proximity; a floor keeps it visible
  // (ambient pre-bond presence + a sanity check that the scene is rendering).
  const length = 0.4 + Math.abs(targetZ) * clamp01(e.proximity);
  const opacity = 0.25 + 0.75 * clamp01(e.strength * Math.max(e.alignment, 0.3));

  return (
    <ViroARScene>
      <ViroAmbientLight color="#ffffff" intensity={250} />
      <ViroNode position={[0, 0, 0]}>
        <ViroBox
          position={[0, 0, -length / 2]}
          scale={[0.06, 0.06, length]}
          materials={['bridgeBeam']}
          opacity={opacity}
        />
      </ViroNode>
    </ViroARScene>
  );
}
