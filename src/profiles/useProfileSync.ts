/**
 * Retries the local user's pending profile sync (profileSync.ts) and keeps the
 * `profileSyncPending` indicator responsive. Adaptive cadence: while something is
 * pending it re-checks every few seconds (so the "will sync" banner appears and
 * clears promptly as connectivity drops/returns); when everything is synced it
 * idles at a slow interval.
 *
 * NOTE: depends on React Native; not part of the pure-logic suite.
 */
import { useEffect } from 'react';
import { useStore } from '../state/store';
import { profilesEnabled } from '../lib/profiles';
import { flushPendingProfile } from './profileSync';

const FAST_MS = 5000; // while a sync is pending — react quickly to reconnect
const IDLE_MS = 30000; // nothing to sync — just a slow safety net

export function useProfileSync(): void {
  useEffect(() => {
    if (!profilesEnabled()) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      await flushPendingProfile();
      if (cancelled) return;
      const next = useStore.getState().profileSyncPending ? FAST_MS : IDLE_MS;
      timer = setTimeout(() => void tick(), next);
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
}
