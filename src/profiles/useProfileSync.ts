/**
 * Retries the local user's pending profile sync (profileSync.ts) on mount and on a
 * slow interval, so a name/photo edited while offline reaches Firestore
 * automatically once there's signal again — no user action, no blocking UI.
 *
 * NOTE: depends on React Native; not part of the pure-logic suite.
 */
import { useEffect } from 'react';
import { profilesEnabled } from '../lib/profiles';
import { flushPendingProfile } from './profileSync';

const RETRY_MS = 30000;

export function useProfileSync(): void {
  useEffect(() => {
    if (!profilesEnabled()) return;
    void flushPendingProfile();
    const timer = setInterval(() => void flushPendingProfile(), RETRY_MS);
    return () => clearInterval(timer);
  }, []);
}
