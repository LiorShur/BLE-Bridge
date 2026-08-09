/**
 * Camera-overlay bridge (the AR-lite renderer).
 *
 * Drawn over a full-screen live camera preview. Per CLAUDE.md §3.2 the bridge is
 * rendered STRAIGHT AHEAD — no world tracking — so this is a centered beam rising
 * from the bottom toward a reticle at screen centre (where the faced peer is),
 * with brightness/height from bond strength, a hue-tinted glow, and a formation
 * pulse. Reads only BondState (§3.4), the same contract the Viro scene used, so
 * this is a drop-in swap for the renderer.
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, StyleSheet, Dimensions } from 'react-native';
import { useStore } from '../state/store';
import { hueByteToHex } from '../ar/effects';
import type { BondState } from '../signal/bond';

const { height: SCREEN_H } = Dimensions.get('window');
const MAX_BEAM = SCREEN_H * 0.42;

function statusLabel(b: BondState): string {
  if (b.bonded) return 'CONNECTED';
  if (b.strength > 0.35) return 'forming…';
  if (b.peer) return 'nearby';
  return 'looking for someone…';
}

export function BridgeOverlay(): React.ReactElement {
  const bond = useStore((s) => s.bond);
  const hue = bond.peer ? hueByteToHex(bond.peer.hue) : '#7cf9ff';

  const strength = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(strength, {
      toValue: bond.strength,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [bond.strength, strength]);

  useEffect(() => {
    if (bond.bonded) {
      const loop = Animated.loop(
        Animated.sequence([
          // useNativeDriver MUST be false here: `strength` also feeds the beam's
          // width (a layout prop), and a value can't be shared across a native and
          // a JS driver — that mix is exactly what threw
          // "Style property 'width' is not supported by native animated module".
          Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
          Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    pulse.setValue(0);
    return undefined;
  }, [bond.bonded, pulse]);

  const beamHeight = strength.interpolate({ inputRange: [0, 1], outputRange: [24, MAX_BEAM] });
  const beamWidth = strength.interpolate({ inputRange: [0, 1], outputRange: [6, 26] });
  const beamOpacity = strength.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.95] });
  const reticleOpacity = strength.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] });
  const reticleScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] });

  // "Turn to face each other" only makes sense when a compass reading exists and
  // the peer is present but poorly aligned.
  const showTurnHint = bond.peer !== null && bond.peer.heading !== null && bond.alignment < 0.3;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Beam rising from the bottom toward centre. */}
      <View style={styles.beamWrap}>
        <Animated.View
          style={[
            styles.beam,
            { width: beamWidth, height: beamHeight, opacity: beamOpacity, backgroundColor: hue, shadowColor: hue },
          ]}
        />
      </View>

      {/* Reticle at screen centre — where the faced peer is. */}
      <View style={styles.reticleWrap}>
        <Animated.View
          style={[styles.reticle, { borderColor: hue, shadowColor: hue, opacity: reticleOpacity, transform: [{ scale: reticleScale }] }]}
        />
      </View>

      {/* Status. */}
      <View style={styles.statusWrap}>
        <Text style={[styles.status, bond.bonded && { color: hue }]}>{statusLabel(bond)}</Text>
        {showTurnHint ? <Text style={styles.hint}>turn to face each other</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  beamWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, top: '50%', alignItems: 'center', justifyContent: 'flex-end' },
  beam: {
    borderRadius: 14,
    marginBottom: 8,
    shadowOpacity: 0.9,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  reticleWrap: { position: 'absolute', left: 0, right: 0, top: '50%', alignItems: 'center', marginTop: -22 },
  reticle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  statusWrap: { position: 'absolute', left: 0, right: 0, top: 60, alignItems: 'center' },
  status: { color: '#e6f1ff', fontSize: 16, fontWeight: '700', letterSpacing: 2 },
  hint: { color: '#9fb3c8', fontSize: 13, marginTop: 6 },
});
