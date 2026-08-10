/**
 * Reaction UI: a send bar (tap an emoji to broadcast it to the bonded peer) and
 * the received-reaction bursts (emoji that pop in when a peer reacts to you).
 *
 * Sends ride the BLE broadcast via the store's outgoing-reaction slot; receipts
 * arrive as store.incomingReactions (populated by useBondEngine). Both carry
 * audio (native ToneGenerator) + haptic cues.
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, Animated, Easing, Vibration, StyleSheet } from 'react-native';
import { useStore } from '../state/store';
import { REACTIONS, reactionById } from '../reactions';
import { Sound } from '../audio/sound';

/** Bottom bar of reaction buttons — only shown while bonded to a peer. */
export function ReactionBar(): React.ReactElement | null {
  const bond = useStore((s) => s.bond);
  const sendReaction = useStore((s) => s.sendReaction);

  if (!bond.bonded || !bond.peer) return null;
  const targetId = bond.peer.peerId;

  return (
    <View style={styles.bar} pointerEvents="box-none">
      <View style={styles.barInner}>
        {REACTIONS.map((r) => (
          <Pressable
            key={r.id}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={() => {
              sendReaction(targetId, r.id);
              Sound.send();
              try {
                Vibration.vibrate(12);
              } catch {
                /* no-op */
              }
            }}
          >
            <Text style={styles.buttonEmoji}>{r.emoji}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** One received reaction: pops up, drifts, fades. Transform+opacity → native driver. */
function Burst({ reactionId }: { reactionId: number }): React.ReactElement {
  const t = useRef(new Animated.Value(0)).current;
  const emoji = reactionById(reactionId)?.emoji ?? '✨';

  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [t]);

  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -140] });
  const scale = t.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.4, 1.3, 1] });
  const opacity = t.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] });

  return <Animated.Text style={[styles.burst, { opacity, transform: [{ translateY }, { scale }] }]}>{emoji}</Animated.Text>;
}

/** Renders + cues newly-arrived reactions. */
export function ReactionBursts(): React.ReactElement {
  const incoming = useStore((s) => s.incomingReactions);
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

  return (
    <View style={styles.burstLayer} pointerEvents="none">
      {incoming.map((r) => (
        <Burst key={r.key} reactionId={r.reactionId} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 18, alignItems: 'center' },
  barInner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(6,10,26,0.6)',
    borderRadius: 28,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  button: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  buttonPressed: { backgroundColor: 'rgba(124,249,255,0.18)' },
  buttonEmoji: { fontSize: 26 },
  burstLayer: { position: 'absolute', left: 0, right: 0, top: '42%', alignItems: 'center' },
  burst: { position: 'absolute', fontSize: 56 },
});
