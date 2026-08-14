/**
 * Fetch-on-bond: when a peer crosses into the bonded state, look up its profile
 * (name/photo) once and cache it in the store. Nothing here blocks the bridge —
 * the fetch is fire-and-forget and the UI shows the anonymous identity until (and
 * unless) a profile arrives.
 *
 * Keyed by peerId, which is now persistent (src/identity/persistentId.ts), so the
 * same person keeps the same profile across sessions. A peer that has no profile
 * document is cached as 'missing' so we don't refetch it every frame.
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import { useEffect } from 'react';
import { useStore } from '../state/store';
import { fetchProfile, profilesEnabled } from '../lib/profiles';
import { savePeerProfileToCache } from './profileCache';

export function useProfiles(): void {
  const bonds = useStore((s) => s.bonds);

  useEffect(() => {
    if (!profilesEnabled()) return;
    const { profiles, setProfileEntry } = useStore.getState();
    const now = Date.now();
    const RETRY_MISSING_MS = 20000; // re-check a peer who set their name late
    for (const b of bonds) {
      // Fetch for ANY detected peer (has a beam), not only bonded ones — else a
      // peer that shows up but hasn't crossed the bond threshold stays stuck on
      // its #TAG forever.
      if (!b.peer) continue;
      const peerId = b.peer.peerId >>> 0;
      const existing = profiles[peerId];
      const recentlyTried = !!existing && now - (existing.triedAt ?? 0) < RETRY_MISSING_MS;

      // Decide whether to (re)fetch Firebase. A GATT-named peer with no photo is a
      // special case: GATT carries name/interests but no photo, so we still fetch
      // Firebase to fill in a photo (this is what un-shadows the Xiaomi's avatar).
      let doFetch: boolean;
      if (!existing) doFetch = true;
      else if (existing.status === 'loading') doFetch = false;
      else if (existing.status === 'missing') doFetch = !recentlyTried;
      // A cache-restored entry is a placeholder — refresh it from the backend when
      // we can, so a stale name/photo gets corrected.
      else if (existing.source === 'cache') doFetch = !recentlyTried;
      else doFetch = existing.source === 'gatt' && !existing.photoURL && !recentlyTried;
      if (!doFetch) continue;

      // Stamp the attempt WITHOUT destroying a GATT entry's name/interests.
      setProfileEntry(peerId, existing ? { ...existing, triedAt: now } : { status: 'loading', triedAt: now });

      void fetchProfile(peerId).then((p) => {
        const cur = useStore.getState().profiles[peerId];
        // A GATT profile is authoritative for name/interests — only ever borrow a
        // photo from Firebase to fill a gap; never overwrite the peer-supplied text.
        if (cur?.source === 'gatt') {
          if (p?.photoURL && !cur.photoURL) {
            useStore.getState().setProfileEntry(peerId, { ...cur, photoURL: p.photoURL });
            void savePeerProfileToCache(peerId, { photoURL: p.photoURL }, Date.now());
          }
          return;
        }
        useStore.getState().setProfileEntry(
          peerId,
          p
            ? {
                status: 'loaded',
                name: p.name,
                photoURL: p.photoURL,
                source: 'firebase',
                // Discovery fields (DISCOVERY_SPEC): cached so useDiscovery can
                // match without a second fetch. Absent when the peer set none.
                ...(p.interests ? { interests: p.interests } : {}),
                ...(p.headline ? { headline: p.headline } : {}),
              }
            : { status: 'missing', triedAt: Date.now() },
        );
        // Persist a successful resolution for offline redundancy on the next launch.
        if (p) {
          void savePeerProfileToCache(
            peerId,
            {
              name: p.name,
              photoURL: p.photoURL,
              ...(p.interests ? { interests: p.interests } : {}),
              ...(p.headline ? { headline: p.headline } : {}),
            },
            Date.now(),
          );
        }
      });
    }
  }, [bonds]);
}
