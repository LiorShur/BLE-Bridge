/**
 * "People nearby" sheet (docs/DISCOVERY_SPEC.md §4.3) — the discovery UI.
 *
 * A modal listing nearby people who are ALSO looking to meet, ranked by shared
 * interests then closeness (the store's `nearby`, written by useDiscovery). At the
 * top is the "Looking to meet" switch: turning it on makes you visible to others
 * AND surfaces your matches (reciprocity — DISCOVERY_SPEC §6). Off by default.
 *
 * Reads only store state; the ranking/matching happen upstream. Rendered in an RN
 * <Modal> (own window above the camera) like the DebugHUD, so touches always land.
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import React from 'react';
import { View, Text, Image, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { useStore, type NearbyPerson } from '../../state/store';
import { VISIBILITY_OPTIONS, isBrowsing } from '../../discovery/visibility';
import { interestById } from '../../discovery/interests';
import { icebreakerFor } from '../../discovery/icebreakers';
import { hueByteToHex } from '../../ar/effects';
import { shortPeerTag } from '../../ui/peerLabel';

function proximityLabel(p: number): string {
  if (p > 0.66) return 'very close';
  if (p > 0.33) return 'close';
  return 'nearby';
}

function PersonCard({ person }: { person: NearbyPerson }): React.ReactElement {
  const hue = hueByteToHex(person.peerId & 0xff);
  const name = person.name ?? shortPeerTag(person.peerId);
  const opener = person.strong ? icebreakerFor(person.shared, person.peerId) : null;

  return (
    <View style={[styles.card, person.strong ? { borderColor: hue } : null]}>
      <View style={styles.cardTop}>
        {person.photoURL ? (
          <Image source={{ uri: person.photoURL }} style={[styles.avatar, { borderColor: hue }]} />
        ) : (
          <View style={[styles.avatar, styles.avatarEmpty, { backgroundColor: hue }]} />
        )}
        <View style={styles.cardId}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {person.headline ? (
            <Text style={styles.headline} numberOfLines={1}>
              {person.headline}
            </Text>
          ) : null}
          <Text style={styles.proximity}>{proximityLabel(person.proximity)}</Text>
        </View>
        {person.score > 0 ? (
          <View style={[styles.scorePill, person.strong ? { backgroundColor: hue } : null]}>
            <Text style={[styles.scoreText, person.strong ? styles.scoreTextStrong : null]}>
              {person.score} shared
            </Text>
          </View>
        ) : null}
      </View>

      {person.shared.length > 0 ? (
        <View style={styles.chips}>
          {person.shared.map((id) => {
            const i = interestById(id);
            return (
              <View key={id} style={styles.chip}>
                <Text style={styles.chipText}>
                  {i ? `${i.emoji} ${i.label}` : id}
                </Text>
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={styles.noShared}>No shared interests yet — but they're open to meeting.</Text>
      )}

      {opener ? <Text style={styles.opener}>💬 {opener}</Text> : null}
    </View>
  );
}

export function NearbySheet(): React.ReactElement | null {
  const open = useStore((s) => s.nearbyOpen);
  const setOpen = useStore((s) => s.setNearbyOpen);
  const visibility = useStore((s) => s.visibility);
  const setVisibility = useStore((s) => s.setVisibility);
  const myInterests = useStore((s) => s.myInterests);
  const nearby = useStore((s) => s.nearby);

  if (!open) return null;

  const close = (): void => setOpen(false);
  const browsing = isBrowsing(visibility);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>People nearby</Text>
            <Pressable style={styles.closeBtn} onPress={close}>
              <Text style={styles.closeTxt}>✕</Text>
            </Pressable>
          </View>

          {/* Visibility selector: a compact chip per mode (DISCOVERY_SPEC §6). */}
          <View style={styles.modeRow}>
            {VISIBILITY_OPTIONS.map((o) => {
              const on = o.mode === visibility;
              return (
                <Pressable
                  key={o.mode}
                  onPress={() => setVisibility(o.mode)}
                  style={[styles.modeChip, on ? styles.modeChipOn : null]}
                >
                  <Text style={[styles.modeChipText, on ? styles.modeChipTextOn : null]}>
                    {o.emoji} {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.modeDesc}>
            {VISIBILITY_OPTIONS.find((o) => o.mode === visibility)?.desc ?? ''}
          </Text>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {!browsing ? (
              <Text style={styles.empty}>
                Pick Open, Curious, or Ghost above to discover nearby people who share your
                interests.
              </Text>
            ) : myInterests.length === 0 ? (
              <Text style={styles.empty}>
                Add a few interests in your profile so we can match you with people nearby.
              </Text>
            ) : nearby.length === 0 ? (
              <Text style={styles.empty}>
                No one nearby is discoverable right now. When someone else nearby turns on Open or
                Curious, they’ll appear here — closest and best-matched first.
              </Text>
            ) : (
              nearby.map((p) => <PersonCard key={p.peerId} person={p} />)
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(2,4,12,0.6)' },
  sheet: {
    maxHeight: '80%',
    backgroundColor: 'rgba(10,15,32,0.98)',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: 'rgba(124,249,255,0.2)',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 28,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { color: '#e6f1ff', fontSize: 20, fontWeight: '800', letterSpacing: 0.5 },
  closeBtn: { padding: 6 },
  closeTxt: { color: '#9fb3c8', fontSize: 20, fontWeight: '700' },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
  modeChip: {
    backgroundColor: 'rgba(6,10,26,0.7)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(124,249,255,0.15)',
    paddingHorizontal: 11,
    paddingVertical: 7,
    marginRight: 7,
    marginBottom: 7,
  },
  modeChipOn: { borderColor: '#7cf9ff', backgroundColor: 'rgba(124,249,255,0.14)' },
  modeChipText: { color: '#9fb3c8', fontSize: 13, fontWeight: '700' },
  modeChipTextOn: { color: '#e6f1ff' },
  modeDesc: { color: '#7f92aa', fontSize: 12, lineHeight: 16, marginBottom: 12, paddingHorizontal: 2 },
  list: { flexGrow: 0 },
  listContent: { paddingBottom: 8 },
  empty: { color: '#8aa0bd', fontSize: 14, lineHeight: 21, textAlign: 'center', paddingVertical: 28, paddingHorizontal: 8 },
  card: {
    backgroundColor: 'rgba(18,26,52,0.85)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(124,249,255,0.12)',
    padding: 14,
    marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, backgroundColor: '#0d1530' },
  avatarEmpty: { opacity: 0.85 },
  cardId: { flex: 1, marginLeft: 12 },
  name: { color: '#e6f1ff', fontSize: 16, fontWeight: '700' },
  headline: { color: '#9fb3c8', fontSize: 13, marginTop: 2 },
  proximity: { color: '#6d7f97', fontSize: 11, marginTop: 3, letterSpacing: 0.5, textTransform: 'uppercase' },
  scorePill: {
    backgroundColor: 'rgba(124,249,255,0.14)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 8,
  },
  scoreText: { color: '#7cf9ff', fontSize: 12, fontWeight: '700' },
  scoreTextStrong: { color: '#04203a' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  chip: {
    backgroundColor: 'rgba(124,249,255,0.1)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 6,
  },
  chipText: { color: '#cfe0f5', fontSize: 12, fontWeight: '600' },
  noShared: { color: '#6d7f97', fontSize: 12, marginTop: 10, fontStyle: 'italic' },
  opener: { color: '#bfe9ef', fontSize: 13, lineHeight: 19, marginTop: 12 },
});
