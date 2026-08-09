/**
 * Stage-1 on-screen bridge visualization (no camera/AR).
 *
 * Renders one "bridge" per active peer from the store's multi-peer `bonds`
 * array: a light-beam between YOU (left) and the peer (right) that fills and
 * brightens with bond strength, glows in the peer's aura hue, and pulses on
 * formation. Reads only BondState — same contract the AR scene will use
 * (CLAUDE.md §3.4), so Stage 2 swaps the renderer without touching the engine.
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, StyleSheet } from 'react-native';
import { useStore } from '../state/store';
import { hueByteToHex } from '../ar/effects';
import type { BondState } from '../signal/bond';

function stateLabel(b: BondState): string {
  if (b.bonded) return 'CONNECTED';
  if (b.strength > 0.35) return 'forming…';
  if (b.proximity > 0.15) return 'nearby';
  return 'searching…';
}

function BridgeRow({ bond }: { bond: BondState }): React.ReactElement {
  const hue = bond.peer ? hueByteToHex(bond.peer.hue) : '#7cf9ff';
  const fill = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fill, {
      toValue: bond.strength,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // animating width %
    }).start();
  }, [bond.strength, fill]);

  useEffect(() => {
    if (bond.bonded) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    pulse.setValue(0);
    return undefined;
  }, [bond.bonded, pulse]);

  const widthPct = fill.interpolate({ inputRange: [0, 1], outputRange: ['6%', '100%'] });
  const glow = fill.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1] });
  const peerScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });

  return (
    <View style={styles.row}>
      <View style={styles.nodes}>
        <View style={[styles.dot, { backgroundColor: '#7cf9ff' }]} />
        <View style={styles.track}>
          <Animated.View
            style={[
              styles.fillBar,
              { width: widthPct, backgroundColor: hue, opacity: glow, shadowColor: hue },
            ]}
          />
        </View>
        <Animated.View
          style={[
            styles.dot,
            { backgroundColor: hue, shadowColor: hue, transform: [{ scale: peerScale }], opacity: 0.4 + 0.6 * (bond.proximity || 0) },
          ]}
        />
      </View>
      <View style={styles.meta}>
        <Text style={[styles.stateText, bond.bonded && { color: hue }]}>{stateLabel(bond)}</Text>
        <Text style={styles.metaText}>
          {bond.peer ? `#${bond.peer.peerId.toString(16).slice(-4)}` : '—'} · {(bond.proximity * 100).toFixed(0)}%
        </Text>
      </View>
    </View>
  );
}

export function BridgeView2D(): React.ReactElement {
  const bonds = useStore((s) => s.bonds);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{bonds.length === 0 ? 'Looking for someone nearby…' : `${bonds.length} nearby`}</Text>
      <Text style={styles.subtitle}>Stand close to someone else running AuraBridge.</Text>

      <View style={styles.list}>
        {bonds.length === 0 ? (
          <View style={styles.empty}>
            <View style={[styles.dot, styles.emptyDot]} />
            <Text style={styles.emptyText}>No bridges yet</Text>
          </View>
        ) : (
          bonds.map((b) => <BridgeRow key={b.peer?.peerId ?? Math.random()} bond={b} />)
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060a1a', paddingTop: 72, paddingHorizontal: 20 },
  title: { color: '#e6f1ff', fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#7f93ab', fontSize: 14, marginTop: 6, marginBottom: 28 },
  list: { flex: 1 },
  row: { marginBottom: 26 },
  nodes: { flexDirection: 'row', alignItems: 'center' },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  track: {
    flex: 1,
    height: 10,
    marginHorizontal: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(124,249,255,0.08)',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  fillBar: { height: 10, borderRadius: 5, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  meta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  stateText: { color: '#9fb3c8', fontSize: 12, fontWeight: '600', letterSpacing: 1 },
  metaText: { color: '#5f7391', fontSize: 12 },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyDot: { backgroundColor: '#26324a', width: 14, height: 14, borderRadius: 7 },
  emptyText: { color: '#3f4f68', marginTop: 12, fontSize: 14 },
});
