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
import { View, Text, Image, Pressable, Modal, Animated, Easing, Vibration, StyleSheet, Dimensions } from 'react-native';
import { useStore } from '../state/store';
import { hueByteToHex } from '../ar/effects';
import { Sound } from '../audio/sound';
import { reactionById } from '../reactions';
import { shortPeerTag } from './peerLabel';
import type { BondState } from '../signal/bond';
import type { IncomingReaction, ProfileEntry } from '../state/store';

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

const PARTICLE_COUNT = 7;

/**
 * A single mote of light rising up the beam and fading out, looping forever with
 * a per-index phase offset so the stream looks continuous rather than pulsed.
 * Runs entirely on the native driver (transform + opacity only) — independent of
 * the beam's JS-driven layout animations, so the two never share a value.
 */
function Particle({ index, hue }: { index: number; hue: string }): React.ReactElement {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const DURATION = 1700;
    const anim = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: DURATION, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    // Stagger each mote across the cycle so they don't all launch together.
    const delay = (index / PARTICLE_COUNT) * DURATION;
    const timer = setTimeout(() => anim.start(), delay);
    return () => {
      clearTimeout(timer);
      anim.stop();
    };
  }, [t, index]);
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -MAX_BEAM] });
  const opacity = t.interpolate({ inputRange: [0, 0.1, 0.75, 1], outputRange: [0, 0.95, 0.5, 0] });
  const scale = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 1, 0.4] });
  return (
    <Animated.View
      style={[styles.particle, { backgroundColor: hue, shadowColor: hue, opacity, transform: [{ translateY }, { scale }] }]}
    />
  );
}

function Beam({
  bond,
  reactions,
  profile,
}: {
  bond: BondState;
  reactions: IncomingReaction[];
  profile: ProfileEntry | undefined;
}): React.ReactElement {
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
  const coreWidth = strength.interpolate({ inputRange: [0, 1], outputRange: [2, 7] });
  const coreOpacity = strength.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  const particleDim = strength.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });
  const reticleOpacity = strength.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  const reticleScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.28] });
  // Breathing halo behind the reticle.
  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1.15, 1.6] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.42, 0.14] });
  const burstScale = burst.interpolate({ inputRange: [0, 1], outputRange: [0.3, 2.8] });
  const burstOpacity = burst.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] });
  // Bright radial flash at the moment of formation.
  const flashScale = burst.interpolate({ inputRange: [0, 1], outputRange: [0.2, 3.4] });
  const flashOpacity = burst.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.7, 0.28, 0] });

  return (
    <View style={styles.beamItem} pointerEvents="box-none">
      <View style={styles.reticleHolder} pointerEvents="box-none">
        {/* Received reactions float up from this specific peer's reticle. */}
        {reactions.map((r) => (
          <ReactionFloat key={r.key} reactionId={r.reactionId} />
        ))}
        {/* Bright radial flash at the instant of formation (behind everything). */}
        <Animated.View
          style={[styles.flash, { backgroundColor: hue, shadowColor: hue, opacity: flashOpacity, transform: [{ scale: flashScale }] }]}
        />
        {/* Soft breathing halo behind the reticle while bonded. */}
        <Animated.View
          style={[styles.halo, { backgroundColor: hue, opacity: haloOpacity, transform: [{ scale: haloScale }] }]}
        />
        <Animated.View
          style={[styles.burst, { borderColor: hue, opacity: burstOpacity, transform: [{ scale: burstScale }] }]}
        />
        <Animated.View
          style={[styles.reticle, { borderColor: hue, shadowColor: hue, opacity: reticleOpacity, transform: [{ scale: reticleScale }] }]}
        />
      </View>
      {/* Identity chip: tap to enlarge. Profile name/photo once known, else hue + #TAG. */}
      {bond.peer ? (
        <Pressable style={styles.chip} onPress={() => useStore.getState().setExpandedPeer(bond.peer!.peerId)}>
          {profile?.status === 'loaded' && profile.photoURL ? (
            <Image source={{ uri: profile.photoURL }} style={[styles.chipAvatar, { borderColor: hue }]} />
          ) : (
            <View style={[styles.chipDot, { backgroundColor: hue }]} />
          )}
          <Text style={styles.chipText} numberOfLines={1}>
            {profile?.status === 'loaded' && profile.name ? profile.name : shortPeerTag(bond.peer.peerId)}
          </Text>
        </Pressable>
      ) : null}
      <Animated.View
        style={[styles.beam, { width: beamWidth, height: beamHeight, opacity: beamOpacity, backgroundColor: hue, shadowColor: hue }]}
      >
        {/* A hot white core down the centre of the beam, brightening with strength. */}
        <Animated.View style={[styles.beamCore, { width: coreWidth, opacity: coreOpacity }]} />
        {/* Energy motes flowing up the beam; dimmed when the bond is weak. */}
        <Animated.View style={[styles.particleLayer, { opacity: particleDim }]} pointerEvents="none">
          {Array.from({ length: PARTICLE_COUNT }, (_, i) => (
            <Particle key={i} index={i} hue={hue} />
          ))}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

export function BridgeOverlay(): React.ReactElement {
  const bonds = useStore((s) => s.bonds);
  const incoming = useStore((s) => s.incomingReactions);
  const profiles = useStore((s) => s.profiles);
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
    // box-none: only the tappable identity chips capture touches; beams/status
    // pass through. The rest of the screen stays interactive.
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={styles.beamRow} pointerEvents="box-none">
        {list.map((b) => (
          <Beam
            key={b.peer?.peerId ?? Math.random()}
            bond={b}
            reactions={reactionsByPeer(b.peer?.peerId)}
            profile={b.peer ? profiles[b.peer.peerId >>> 0] : undefined}
          />
        ))}
      </View>

      <View style={styles.statusWrap} pointerEvents="none">
        <Text style={[styles.status, primary?.bonded && primary.peer ? { color: hueByteToHex(primary.peer.hue) } : null]}>
          {statusLabel(primary)}
        </Text>
        {list.length > 1 ? <Text style={styles.sub}>{list.length} nearby</Text> : null}
        {showTurnHint ? <Text style={styles.hint}>turn to face each other</Text> : null}
      </View>

      <ProfileCard />
    </View>
  );
}

/** Enlarged profile card shown when a beam's identity chip is tapped. */
function ProfileCard(): React.ReactElement | null {
  const expandedPeerId = useStore((s) => s.expandedPeerId);
  const profiles = useStore((s) => s.profiles);
  const bonds = useStore((s) => s.bonds);
  const setExpandedPeer = useStore((s) => s.setExpandedPeer);
  if (expandedPeerId == null) return null;

  const bond = bonds.find((b) => b.peer?.peerId === expandedPeerId);
  const hue = bond?.peer ? hueByteToHex(bond.peer.hue) : '#7cf9ff';
  const profile = profiles[expandedPeerId >>> 0];
  const name = profile?.status === 'loaded' && profile.name ? profile.name : shortPeerTag(expandedPeerId);
  const photoURL = profile?.status === 'loaded' ? profile.photoURL : null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setExpandedPeer(null)} statusBarTranslucent>
      <Pressable style={styles.cardBackdrop} onPress={() => setExpandedPeer(null)}>
        <View style={[styles.card, { borderColor: hue }]}>
          {photoURL ? (
            <Image source={{ uri: photoURL }} style={[styles.cardPhoto, { borderColor: hue }]} />
          ) : (
            <View style={[styles.cardPhoto, styles.cardPhotoEmpty, { borderColor: hue, backgroundColor: hue }]} />
          )}
          <Text style={styles.cardName}>{name}</Text>
          <Text style={styles.cardTag}>{shortPeerTag(expandedPeerId)}</Text>
          <Text style={styles.cardHint}>tap anywhere to close</Text>
        </View>
      </Pressable>
    </Modal>
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
  chipAvatar: { width: 18, height: 18, borderRadius: 9, marginRight: 6, borderWidth: 1, backgroundColor: '#0d1530' },
  chipText: { color: '#cfe0f5', fontSize: 11, fontWeight: '600', letterSpacing: 0.5, maxWidth: 96 },
  cardBackdrop: { flex: 1, backgroundColor: 'rgba(4,6,16,0.8)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    backgroundColor: 'rgba(18,26,52,0.98)',
    borderRadius: 20,
    borderWidth: 2,
    paddingVertical: 28,
    paddingHorizontal: 32,
    alignItems: 'center',
    maxWidth: 340,
  },
  cardPhoto: { width: 200, height: 200, borderRadius: 100, borderWidth: 3, backgroundColor: '#0d1530' },
  cardPhotoEmpty: { opacity: 0.85 },
  cardName: { color: '#e6f1ff', fontSize: 24, fontWeight: '700', marginTop: 18 },
  cardTag: { color: '#9fb3c8', fontSize: 14, marginTop: 4, letterSpacing: 1 },
  cardHint: { color: '#5b6b82', fontSize: 12, marginTop: 18 },
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
  halo: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  flash: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    shadowOpacity: 1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
  },
  beam: {
    borderRadius: 12,
    shadowOpacity: 0.9,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  beamCore: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: 6,
    backgroundColor: '#ffffff',
  },
  particleLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  particle: {
    position: 'absolute',
    bottom: 4,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  statusWrap: { position: 'absolute', left: 0, right: 0, top: 64, alignItems: 'center' },
  status: { color: '#e6f1ff', fontSize: 18, fontWeight: '700', letterSpacing: 2 },
  sub: { color: '#9fb3c8', fontSize: 13, marginTop: 4 },
  hint: { color: '#9fb3c8', fontSize: 13, marginTop: 6 },
});
