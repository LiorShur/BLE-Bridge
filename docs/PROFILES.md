# Peer profiles (name + photo on connect)

An **optional** identity layer. When two devices bond, each fetches the other's
public profile — `{ name, photoURL }` — and shows it on the bridge instead of the
anonymous hue + `#TAG`. Owner-approved scope change (2026-08-10); see CLAUDE.md
non-goals.

## How it works

- **Key = persistent `peerId`.** `peerId` is now stored in AsyncStorage
  (`src/identity/persistentId.ts`), so the same person keeps the same identity
  across launches. The BLE payload is **unchanged** — `peerId` already rides every
  advertisement; only the name/photo lookup is out-of-band.
- **Fetch on bond.** `src/profiles/useProfiles.ts` watches bonded peers and
  fetches `profiles/{peerId}` from Firestore once each, caching the result.
- **Set your own.** The profile screen (`src/screens/ProfileScreen.tsx`, shown
  after onboarding) writes `profiles/{myPeerId}`. Skipping stays anonymous.
- **Graceful.** No Firebase config, or any error/offline → every call is a
  null/no-op and the UI falls back to hue + `#TAG`. The bridge never depends on
  the network.

## Backend setup (owner)

Firebase Web config is injected by CI from these repo secrets:
`FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`,
`FIREBASE_STORAGE_BUCKET`, `FIREBASE_APP_ID`. Enable **Firestore**, **Anonymous
auth**, and (for #2b photos) **Storage**.

### Recommended Firestore rules

Test mode expires. Replace it with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /profiles/{peerId} {
      allow read: if true;                        // public identity
      allow write: if request.auth != null        // signed in (anonymous ok)
        && request.resource.data.name is string
        && request.resource.data.name.size() <= 40;
    }
  }
}
```

### Known limitation (PoC)

`peerId` is a random client value, not tied to the Firebase auth uid, so the
rules above let **any signed-in device write any profile doc** — a peer could
overwrite another's name. Acceptable for a small pilot. Hardening options for
later: tie the doc id to the auth uid, or have a Cloud Function mint/validate the
peerId↔uid binding.

## Photos

Three sources (`src/screens/ProfileScreen.tsx`, via `react-native-image-picker`):
**take a selfie** (front camera), **choose from gallery**, or **paste a URL**. A
camera/gallery pick is uploaded to Storage (`profilePhotos/{peerId}.jpg`) on save
via `uploadProfilePhoto()`; its download URL becomes the profile `photoURL`.

### Recommended Storage rules

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /profilePhotos/{file} {
      allow read: if true;                 // public avatars
      allow write: if request.auth != null // signed in (anonymous ok)
        && request.resource.size < 2 * 1024 * 1024
        && request.resource.contentType.matches('image/.*');
    }
  }
}
```

Same PoC caveat as Firestore: the path isn't tied to the auth uid, so any
signed-in device could overwrite any avatar. Fine for a pilot.

> **RN note:** Firestore is forced onto long-polling
> (`experimentalForceLongPolling`) in `src/lib/profiles.ts` — the default
> WebChannel transport does not work under React Native and silently fails reads
> and writes.
