/**
 * Discovery runtime (docs/DISCOVERY_SPEC.md §4.2) — the glue between the pure
 * matching brain (match.ts) and the store.
 *
 * Each time the nearby peers or the cached profiles change, and ONLY while the
 * local user is in discovery mode, it:
 *   1. takes every nearby peer that is ALSO advertising LOOKING_TO_MEET
 *      (reciprocity — DISCOVERY_SPEC §6: no lurking),
 *   2. reads that peer's interests from the profile cache (fetched by useProfiles),
 *   3. computes the shared-interest match against my interests,
 *   4. ranks by (shared count, then proximity) and writes the list to the store.
 *
 * The bond engine already carries the peer's `flags` through PeerSnapshot, so the
 * LOOKING bit needs no extra plumbing. When discovery is off we publish an empty
 * list (and, being not-looking, we're invisible to others too).
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite. The
 * scoring/ranking it calls (match.ts) is separately unit tested.
 */
import { useEffect } from 'react';
import { useStore, isBrowsing, type NearbyPerson } from '../state/store';
import { FLAG_LOOKING_TO_MEET } from '../ble/payload';
import { computeMatch, isStrongMatch, rankCandidates } from './match';

export function useDiscovery(): void {
  const bonds = useStore((s) => s.bonds);
  const profiles = useStore((s) => s.profiles);
  const visibility = useStore((s) => s.visibility);
  const myInterests = useStore((s) => s.myInterests);

  useEffect(() => {
    const setNearby = useStore.getState().setNearby;
    if (!isBrowsing(visibility)) {
      setNearby([]); // 'off' → no browsing (and, being off, invisible too)
      return;
    }
    // In 'ghost' we browse without broadcasting; open/curious do both.

    const candidates = bonds
      .filter((b) => b.peer && (b.peer.flags & FLAG_LOOKING_TO_MEET) !== 0)
      .map((b) => {
        const peer = b.peer!;
        const peerId = peer.peerId >>> 0;
        const prof = profiles[peerId];
        const loaded = prof?.status === 'loaded' ? prof : undefined;
        const theirInterests = loaded?.interests ?? [];
        const match = computeMatch(peerId, myInterests, theirInterests);
        return {
          match,
          proximity: b.proximity,
          name: loaded?.name ?? null,
          photoURL: loaded?.photoURL ?? null,
          headline: loaded?.headline ?? null,
        };
      });

    const nearby: NearbyPerson[] = rankCandidates(candidates).map((c) => ({
      peerId: c.match.peerId,
      name: c.name,
      photoURL: c.photoURL,
      headline: c.headline,
      shared: c.match.shared,
      score: c.match.score,
      proximity: c.proximity,
      strong: isStrongMatch(c.match),
    }));

    setNearby(nearby);
  }, [bonds, profiles, visibility, myInterests]);
}
