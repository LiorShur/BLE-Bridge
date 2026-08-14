/**
 * Background flush of the local user's PENDING profile sync (pendingSync.ts).
 *
 * Writes are local-first; when the cloud couldn't be reached the change is stashed
 * as "pending". This hook retries that stash on mount and on a slow interval, so a
 * name/photo edited while offline reaches Firestore automatically once there's
 * signal again — no user action, no blocking UI. Reflected in
 * `store.profileSyncPending` for an "offline — will sync" indicator.
 *
 * NOTE: depends on React Native; not part of the pure-logic suite.
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { profilesEnabled, uploadProfilePhoto, saveProfile } from '../lib/profiles';
import { getPendingProfileSync, clearPendingProfileSync, setPendingProfileSync } from './pendingSync';

const RETRY_MS = 30000;

export function useProfileSync(): void {
  const running = useRef(false);

  useEffect(() => {
    if (!profilesEnabled()) return;
    let cancelled = false;

    const flush = async (): Promise<void> => {
      if (running.current) return;
      running.current = true;
      try {
        const pending = await getPendingProfileSync();
        const store = useStore.getState();
        if (!pending) {
          if (store.profileSyncPending) store.setProfileSyncPending(false);
          return;
        }
        store.setProfileSyncPending(true);

        // Upload the photo first if one is still waiting (deferred earlier).
        let photoURL = pending.photoURL;
        if (!photoURL && pending.photoLocalUri) {
          const up = await uploadProfilePhoto(pending.peerId, pending.photoLocalUri);
          if (up.url) photoURL = up.url;
          else if (up.deferred) return; // still offline — try again next tick
          // else: a real upload error — save the doc anyway, without a new photo
        }

        const res = await saveProfile(pending.peerId, {
          name: pending.name,
          photoURL,
          ...(pending.interests.length ? { interests: pending.interests } : {}),
          ...(pending.headline ? { headline: pending.headline } : {}),
        });
        if (res.ok) {
          await clearPendingProfileSync();
          const s = useStore.getState();
          if (photoURL && photoURL !== s.myPhotoURL) s.setMyProfile(s.myName, photoURL);
          s.setProfileSyncPending(false);
        } else if (res.deferred) {
          // Still offline. If we managed to upload the photo, remember its URL so we
          // don't re-upload next time.
          if (photoURL && photoURL !== pending.photoURL) {
            await setPendingProfileSync({ ...pending, photoURL, photoLocalUri: null });
          }
        } else {
          // A real backend error (e.g. permission-denied) won't fix itself on retry.
          await clearPendingProfileSync();
          useStore.getState().setProfileSyncPending(false);
        }
      } finally {
        running.current = false;
      }
    };

    void flush();
    const timer = setInterval(() => {
      if (!cancelled) void flush();
    }, RETRY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
}
