/**
 * Reaction send bar: tap an emoji to broadcast it to a bonded peer.
 *
 * Multi-peer: when more than one peer is bonded, a target-selector row of peer
 * chips appears above the emoji row — tap a chip to choose who the reaction goes
 * to. With a single bonded peer the selector is hidden and that peer is the
 * implicit target. Sends ride the store's outgoing-reaction slot; received
 * reactions are rendered per-peer by BridgeOverlay, which owns the receive cue.
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Vibration, StyleSheet } from 'react-native';
import { useStore } from '../state/store';
import { REACTIONS } from '../reactions';
import { Sound } from '../audio/sound';
import { hueByteToHex } from '../ar/effects';
import { shortPeerTag } from './peerLabel';
import type { BondState } from '../signal/bond';

/** Bottom bar of reaction buttons — only shown while bonded to at least one peer. */
export function ReactionBar(): React.ReactElement | null {
  const bonds = useStore((s) => s.bonds);
  const profiles = useStore((s) => s.profiles);
  const sendReaction = useStore((s) => s.sendReaction);

  // Bonded peers, strongest first (bonds is already sorted by the engine).
  const targets: BondState[] = bonds.filter((b) => b.bonded && b.peer);

  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Keep the selection valid: default to the strongest bond, and if the chosen
  // peer drops out, fall back to whoever is now strongest.
  useEffect(() => {
    const ids = targets.map((b) => b.peer!.peerId);
    if (selectedId === null || !ids.includes(selectedId)) {
      setSelectedId(ids[0] ?? null);
    }
  }, [targets, selectedId]);

  if (targets.length === 0) return null;

  // The effective target: the selected peer if still valid, else the strongest.
  const activeId = selectedId != null && targets.some((b) => b.peer!.peerId === selectedId)
    ? selectedId
    : targets[0].peer!.peerId;

  const fire = (reactionId: number): void => {
    sendReaction(activeId, reactionId);
    Sound.send();
    try {
      Vibration.vibrate(12);
    } catch {
      /* no-op */
    }
  };

  return (
    <View style={styles.bar} pointerEvents="box-none">
      {targets.length > 1 ? (
        <View style={styles.selectorRow}>
          {targets.map((b) => {
            const peerId = b.peer!.peerId;
            const hue = hueByteToHex(b.peer!.hue);
            const active = peerId === activeId;
            const prof = profiles[peerId >>> 0];
            const label = prof?.status === 'loaded' && prof.name ? prof.name : shortPeerTag(peerId);
            return (
              <Pressable
                key={peerId}
                onPress={() => setSelectedId(peerId)}
                style={[styles.target, active && { borderColor: hue, backgroundColor: 'rgba(124,249,255,0.14)' }]}
              >
                <View style={[styles.targetDot, { backgroundColor: hue }]} />
                <Text style={[styles.targetText, active && styles.targetTextActive]} numberOfLines={1}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={styles.barInner}>
        {REACTIONS.map((r) => (
          <Pressable
            key={r.id}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={() => fire(r.id)}
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
  selectorRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginBottom: 8 },
  target: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: 'rgba(6,10,26,0.5)',
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 4,
    marginHorizontal: 3,
    marginVertical: 2,
  },
  targetDot: { width: 8, height: 8, borderRadius: 4, marginRight: 5 },
  targetText: { color: '#9fb3c8', fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  targetTextActive: { color: '#e6f1ff' },
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
