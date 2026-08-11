/**
 * Profile backend — the ONLY network dependency in the app, and an optional one.
 *
 * A "profile" is a tiny public document {name, photoURL} keyed by the device's
 * persistent peerId (see src/identity/persistentId.ts). It is fetched lazily when
 * a peer *bonds* (src/profiles/useProfiles.ts) and written when the local user
 * sets their name (ProfileScreen). Everything degrades gracefully: if Firebase is
 * not configured, or the network is down, every call resolves to null/no-op and
 * the UI falls back to the anonymous hue + #TAG identity.
 *
 * Uses the Firebase JS SDK (not the native module) so it needs no extra Gradle
 * plumbing in our overlay CI. Auth is anonymous — enough to satisfy "signed-in"
 * Firestore rules without any account UX.
 *
 * NOTE: depends on React Native + firebase; not part of the pure-logic test suite.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  initializeFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { initializeAuth, getReactNativePersistence, signInAnonymously, type Auth } from 'firebase/auth';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firebaseConfig, isFirebaseConfigured } from '../lib/firebaseConfig';

export interface Profile {
  name: string;
  photoURL: string | null;
}

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let authReady: Promise<void> | null = null;

/** True when a backend is configured and reachable enough to try. */
export function profilesEnabled(): boolean {
  return isFirebaseConfigured();
}

/**
 * Resolve once anonymous auth has settled, returning whether we actually have a
 * signed-in user. If this is false, every Firestore/Storage WRITE will be denied
 * (rules require request.auth != null) — the usual cause is the Anonymous
 * sign-in provider not being enabled in the Firebase console.
 */
export async function ensureSignedIn(): Promise<boolean> {
  if (!ensureInit()) return false;
  try {
    if (authReady) await authReady;
  } catch {
    /* ignore */
  }
  return !!auth?.currentUser;
}

function ensureInit(): boolean {
  if (!isFirebaseConfigured()) return false;
  if (app) return true;
  try {
    app = initializeApp(firebaseConfig);
    // React Native's networking doesn't support Firestore's default WebChannel
    // streaming transport — getDoc/setDoc silently hang/fail. Forcing long
    // polling is the documented fix for RN and is REQUIRED here (this was why
    // names weren't appearing). auto-detect is unreliable in RN; force it.
    db = initializeFirestore(app, { experimentalForceLongPolling: true });
  } catch {
    app = null;
    db = null;
    return false;
  }
  // Auth is best-effort and independent of Firestore: if anonymous auth can't
  // initialise (RN persistence quirks), we still return Firestore and let the
  // rules decide. authReady always resolves so callers never hang.
  try {
    auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
    authReady = signInAnonymously(auth)
      .then(() => undefined)
      .catch(() => undefined);
  } catch {
    auth = null;
    authReady = Promise.resolve();
  }
  return true;
}

const PROFILES = 'profiles';

/** Fetch a peer's profile by peerId. Returns null when absent/disabled/errored. */
export async function fetchProfile(peerId: number): Promise<Profile | null> {
  if (!ensureInit() || !db) return null;
  try {
    if (authReady) await authReady;
    const snap = await getDoc(doc(db, PROFILES, String(peerId >>> 0)));
    if (!snap.exists()) return null;
    const data = snap.data() as { name?: unknown; photoURL?: unknown };
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) return null;
    const photoURL = typeof data.photoURL === 'string' && data.photoURL ? data.photoURL : null;
    return { name, photoURL };
  } catch {
    return null;
  }
}

export interface UploadResult {
  url?: string;
  /** Firebase error code (e.g. 'storage/unauthorized') or a reason string. */
  error?: string;
}

/**
 * Fetch a local file/content URI into a NATIVE React Native Blob via XHR.
 *
 * This is the one upload path that works in RN: both `uploadBytes(blob-from-
 * fetch)` and `uploadString(base64)` make the Firebase SDK build a Blob from an
 * ArrayBuffer, which RN's Blob does not support ("Creating blobs from
 * 'ArrayBuffer' … are not supported"). An XHR with responseType 'blob' returns a
 * native-backed Blob the SDK uploads directly, no ArrayBuffer conversion.
 */
function uriToBlob(uri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response as Blob);
    xhr.onerror = () => reject(new Error('uri-to-blob-failed'));
    xhr.responseType = 'blob';
    xhr.open('GET', uri, true);
    xhr.send(null);
  });
}

/**
 * Upload a local image (file:// or content:// URI, from camera or gallery) to
 * Storage under this peerId and return its public download URL. Returns the
 * Firebase error code on failure so the UI can distinguish a rules problem
 * (storage/unauthorized) from a bucket/config problem (storage/unknown).
 */
export async function uploadProfilePhoto(peerId: number, localUri: string): Promise<UploadResult> {
  if (!ensureInit() || !app) return { error: 'firebase-unconfigured' };
  try {
    if (authReady) await authReady;
    const storage = getStorage(app);
    const r = storageRef(storage, `profilePhotos/${peerId >>> 0}.jpg`);
    const blob = await uriToBlob(localUri);
    await uploadBytes(r, blob, { contentType: 'image/jpeg' });
    // RN blobs hold a native resource; release it.
    (blob as unknown as { close?: () => void }).close?.();
    const url = await getDownloadURL(r);
    return { url };
  } catch (e) {
    const code = (e as { code?: string })?.code ?? (e as Error)?.message ?? 'upload-failed';
    return { error: code };
  }
}

/** Write (merge) the local user's profile under its peerId. Returns success. */
export async function saveProfile(peerId: number, profile: Profile): Promise<boolean> {
  if (!ensureInit() || !db) return false;
  try {
    if (authReady) await authReady;
    await setDoc(
      doc(db, PROFILES, String(peerId >>> 0)),
      { name: profile.name.trim(), photoURL: profile.photoURL ?? null, updatedAt: serverTimestamp() },
      { merge: true },
    );
    return true;
  } catch {
    return false;
  }
}
