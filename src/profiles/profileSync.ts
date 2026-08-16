/**
 * Flush the local user's PENDING profile sync (pendingSync.ts) to the cloud.
 *
 * Called fire-and-forget right after a local save (so Save never blocks on the
 * network) and on a slow retry loop (useProfileSync). Idempotent and self-guarded:
 * only one flush runs at a time. All cloud calls are already time-bounded in
 * profiles.ts, so this can't hang.
 *
 * NOTE: depends on React Native; not part of the pure-logic suite.
 */
import { useStore } from '../state/store';
import { uploadProfilePhoto, saveProfile } from '../lib/profiles';
import { getPendingProfileSync, clearPendingProfileSync, setPendingProfileSync } from './pendingSync';

let running = false;

export async function flushPendingProfile(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const pending = await getPendingProfileSync();
    if (!pending) {
      if (useStore.getState().profileSyncPending) useStore.getState().setProfileSyncPending(false);
      return;
    }

    // Upload the photo first if one is still waiting (deferred earlier / just picked).
    let photoURL = pending.photoURL;
    if (!photoURL && pending.photoLocalUri) {
      const up = await uploadProfilePhoto(pending.peerId, pending.photoLocalUri);
      if (up.url) photoURL = up.url;
      else if (up.deferred) {
        useStore.getState().setProfileSyncPending(true); // offline — banner + retry later
        return;
      }
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
      // Still offline. Remember a photo URL we managed to upload so we don't redo it.
      if (photoURL && photoURL !== pending.photoURL) {
        await setPendingProfileSync({ ...pending, photoURL, photoLocalUri: null });
      }
      useStore.getState().setProfileSyncPending(true);
    } else {
      // A real backend error (e.g. permission-denied) won't fix itself on retry.
      await clearPendingProfileSync();
      useStore.getState().setProfileSyncPending(false);
    }
  } finally {
    running = false;
  }
}
