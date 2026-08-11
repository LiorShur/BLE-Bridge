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
      // Skip if loaded, currently loading, or missing-but-recently-tried.
      if (existing && !(existing.status === 'missing' && now - (existing.triedAt ?? 0) > RETRY_MISSING_MS)) {
        continue;
      }
      setProfileEntry(peerId, { status: 'loading', triedAt: now });
      void fetchProfile(peerId).then((p) => {
        useStore.getState().setProfileEntry(
          peerId,
          p
            ? { status: 'loaded', name: p.name, photoURL: p.photoURL }
            : { status: 'missing', triedAt: Date.now() },
        );
      });
    }
  }, [bonds]);
}
