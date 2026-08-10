/**
 * Camera-overlay bridge (the AR-lite renderer).
 *
 * Drawn over a full-screen live camera preview. Per CLAUDE.md §3.2 the bridge is
 * rendered STRAIGHT AHEAD — no world tracking. Multi-peer: one beam per active
 * peer (strongest first), each a bar rising to its own reticle, brightness/height
 * eased from that bond's strength, hue-tinted, with a formation burst + haptic on
 * the moment it connects. Reads only BondState[] (§3.4).
 *
 * All animations run on the JS driver: layout props (width/height) can't be
 * native-driven, and mixing drivers on a shared value crashes (learned the hard
 * way).
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, Vibration, StyleSheet, Dimensions } from 'react-native';
import { useStore } from '../state/store';
import { hueByteToHex } from '../ar/effects';
import { Sound } from '../audio/sound';
import { reactionById } from '../reactions';
import { shortPeerTag } from './peerLabel';
import type { BondState } from '../signal/bond';
import type { IncomingReaction } from '../state/store';

const { height: SCREEN_H } = Dimensions.get('window');
const MAX_BEAM = SCREEN_H * 0.4;
const MAX_BEAMS = 5;

function statusLabel(b: BondState | undefined): string {
  if (!b || !b.peer) return 'looking for someone…';
  if (b.bonded) return 'CONNECTED';
  if (b.strength > 0.3) return 'forming…';
  return 'nearby';
}

/** One received reaction floating up from its sender's beam. */
function ReactionFloat({ reactionId }: { reactionId: number }): React.ReactElement {
  const t = useRef(new Animated.Value(0)).current;
  const emoji = reactionById(reactionId)?.emoji ?? '✨';
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 1500, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [t]);
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -150] });
  const scale = t.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.4, 1.3, 1] });
  const opacity = t.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] });
  return <Animated.Text style={[styles.float, { opacity, transform: [{ translateY }, { scale }] }]}>{emoji}</Animated.Text>;
}

function Beam({ bond, reactions }: { bond: BondState; reactions: IncomingReaction[] }): React.ReactElement {
  const hue = bond.peer ? hueByteToHex(bond.peer.hue) : '#7cf9ff';
  const strength = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const wasBonded = useRef(false);

  useEffect(() => {
    Animated.timing(strength, {
      toValue: bond.strength,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [bond.strength, strength]);

  // Formation moment: haptic + burst ring on the bonded transition.
  useEffect(() => {
    if (bond.bonded && !wasBonded.current) {
      try {
        Vibration.vibrate(45);
      } catch {
        /* vibrator unavailable/denied — never let the moment crash the app */
      }
      Sound.formation();
      burst.setValue(0);
      Animated.timing(burst, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    } else if (!bond.bonded && wasBonded.current) {
      Sound.breakTone();
    }
    wasBonded.current = bond.bonded;
  }, [bond.bonded, burst]);

  // Steady pulse while bonded.
  useEffect(() => {
    if (bond.bonded) {
      const loop = Animated.loop(
        Animated.sequence([
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

  const beamHeight = strength.interpolate({ inputRange: [0, 1], outputRange: [22, MAX_BEAM] });
  const beamWidth = strength.interpolate({ inputRange: [0, 1], outputRange: [6, 22] });
  const beamOpacity = strength.interpolate({ inputRange: [0, 1], outputRange: [0.16, 0.95] });
  const reticleOpacity = strength.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  const reticleScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.28] });
  const burstScale = burst.interpolate({ inputRange: [0, 1], outputRange: [0.3, 2.8] });
  const burstOpacity = burst.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] });

  return (
    <View style={styles.beamItem}>
      <View style={styles.reticleHolder}>
        {/* Received reactions float up from this specific peer's reticle. */}
        {reactions.map((r) => (
          <ReactionFloat key={r.key} reactionId={r.reactionId} />
        ))}
        <Animated.View
          style={[styles.burst, { borderColor: hue, opacity: burstOpacity, transform: [{ scale: burstScale }] }]}
        />
        <Animated.View
          style={[styles.reticle, { borderColor: hue, shadowColor: hue, opacity: reticleOpacity, transform: [{ scale: reticleScale }] }]}
        />
      </View>
      {/* Identity chip: which device this beam is. */}
      {bond.peer ? (
        <View style={styles.chip}>
          <View style={[styles.chipDot, { backgroundColor: hue }]} />
          <Text style={styles.chipText}>{shortPeerTag(bond.peer.peerId)}</Text>
        </View>
      ) : null}
      <Animated.View
        style={[styles.beam, { width: beamWidth, height: beamHeight, opacity: beamOpacity, backgroundColor: hue, shadowColor: hue }]}
      />
    </View>
  );
}

export function BridgeOverlay(): React.ReactElement {
  const bonds = useStore((s) => s.bonds);
  const incoming = useStore((s) => s.incomingReactions);
  const list = bonds.slice(0, MAX_BEAMS);
  const primary = list[0];

  // Fire the "received" audio/haptic cue once per freshly-arrived reaction.
  const seen = useRef<Set<number>>(new Set());
  useEffect(() => {
    for (const r of incoming) {
      if (!seen.current.has(r.key)) {
        seen.current.add(r.key);
        Sound.receive();
        try {
          Vibration.vibrate(20);
        } catch {
          /* no-op */
        }
      }
    }
  }, [incoming]);

  const reactionsByPeer = (peerId: number | undefined): IncomingReaction[] =>
    peerId == null ? [] : incoming.filter((r) => r.fromPeerId === peerId);

  const showTurnHint = primary?.peer != null && primary.peer.heading !== null && primary.alignment < 0.7 && !primary.bonded;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.beamRow}>
        {list.map((b) => (
          <Beam key={b.peer?.peerId ?? Math.random()} bond={b} reactions={reactionsByPeer(b.peer?.peerId)} />
        ))}
      </View>

      <View style={styles.statusWrap}>
        <Text style={[styles.status, primary?.bonded && primary.peer ? { color: hueByteToHex(primary.peer.hue) } : null]}>
          {statusLabel(primary)}
        </Text>
        {list.length > 1 ? <Text style={styles.sub}>{list.length} nearby</Text> : null}
        {showTurnHint ? <Text style={styles.hint}>turn to face each other</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  beamRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 56,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  beamItem: { alignItems: 'center', justifyContent: 'flex-end', marginHorizontal: 18 },
  reticleHolder: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  float: { position: 'absolute', fontSize: 44 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(6,10,26,0.55)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginBottom: 6,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4, marginRight: 5 },
  chipText: { color: '#cfe0f5', fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  reticle: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  burst: { position: 'absolute', width: 48, height: 48, borderRadius: 24, borderWidth: 3 },
  beam: {
    borderRadius: 12,
    shadowOpacity: 0.9,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  statusWrap: { position: 'absolute', left: 0, right: 0, top: 64, alignItems: 'center' },
  status: { color: '#e6f1ff', fontSize: 18, fontWeight: '700', letterSpacing: 2 },
  sub: { color: '#9fb3c8', fontSize: 13, marginTop: 4 },
  hint: { color: '#9fb3c8', fontSize: 13, marginTop: 6 },
});
