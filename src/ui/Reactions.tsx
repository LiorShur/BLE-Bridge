/**
 * Reaction send bar: tap an emoji to broadcast it to the bonded peer.
 *
 * Sends ride the BLE broadcast via the store's outgoing-reaction slot. Received
 * reactions are rendered per-peer (above the sender's beam) by BridgeOverlay,
 * which also owns the receive cue — this file only owns the send side.
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import React from 'react';
import { View, Text, Pressable, Vibration, StyleSheet } from 'react-native';
import { useStore } from '../state/store';
import { REACTIONS } from '../reactions';
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
});
