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
import { resolvedFirebaseConfig as firebaseConfig, isFirebaseConfigured } from '../lib/firebaseConfigResolved';

export interface Profile {
  name: string;
  photoURL: string | null;
  /** Discovery interest tag ids (catalog: src/discovery/interests.ts). */
  interests?: string[];
  /** Optional one-line headline shown in the discovery list. */
  headline?: string;
}

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let authReady: Promise<void> | null = null;
// The real Firebase error from the last anonymous sign-in attempt, captured so
// the UI can show WHY sign-in failed instead of a generic hint. Common codes:
//   auth/admin-restricted-operation  → Anonymous provider disabled in console
//   auth/network-request-failed      → offline / blocked
//   auth/too-many-requests           → throttled (many new anon accounts)
let lastAuthError: string | null = null;

/** True when a backend is configured and reachable enough to try. */
export function profilesEnabled(): boolean {
  return isFirebaseConfigured();
}

/** The last anonymous sign-in error code/message, or null if none/succeeded. */
export function getLastAuthError(): string | null {
  return lastAuthError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A Firestore/Storage write's promise only settles on SERVER ack — offline it never
// resolves, which would hang the UI forever. Every cloud call is raced against this
// timeout so callers get a bounded answer and can fall back to local + deferred sync.
const CLOUD_TIMEOUT_MS = 8000;
const TIMED_OUT = Symbol('cloud-timeout');
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return Promise.race([p, delay(ms).then(() => TIMED_OUT)]);
}
/** Error codes that mean "offline / transient" — safe to retry later, not a real failure. */
function isOfflineCode(code: string): boolean {
  return /unavailable|deadline-exceeded|network|timeout|retry-limit/i.test(code);
}

/**
 * Resolve once anonymous auth has settled, returning whether we actually have a
 * signed-in user. If this is false, every Firestore/Storage WRITE will be denied
 * (rules require request.auth != null) — the usual cause is the Anonymous
 * sign-in provider not being enabled in the Firebase console.
 */
export async function ensureSignedIn(): Promise<boolean> {
  if (!ensureInit() || !auth) return false;
  // Wait for the sign-in kicked off in ensureInit, but never hang the UI on it.
  try {
    await Promise.race([authReady ?? Promise.resolve(), delay(6000)]);
  } catch {
    /* ignore */
  }
  if (auth.currentUser) return true;
  // The initial attempt didn't leave us with a user (a transient failure, a race,
  // or persistence not restoring one). Try once more, explicitly, so we either get
  // signed in or capture the REAL error code for the UI instead of guessing.
  try {
    const r = await withTimeout(signInAnonymously(auth), CLOUD_TIMEOUT_MS);
    lastAuthError = r === TIMED_OUT ? 'auth/timeout-offline' : null;
  } catch (e) {
    lastAuthError = (e as { code?: string })?.code ?? (e as Error)?.message ?? 'auth/unknown';
  }
  return !!auth.currentUser;
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
      .then(() => {
        lastAuthError = null;
      })
      .catch((e: unknown) => {
        // Capture the real reason so the UI can show it (e.g. the Anonymous
        // provider being disabled, network failure, or throttling).
        lastAuthError = (e as { code?: string })?.code ?? (e as Error)?.message ?? 'auth/unknown';
      });
  } catch (e) {
    auth = null;
    lastAuthError = (e as { code?: string })?.code ?? (e as Error)?.message ?? 'auth/init-failed';
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
    const data = snap.data() as { name?: unknown; photoURL?: unknown; interests?: unknown; headline?: unknown };
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) return null;
    const photoURL = typeof data.photoURL === 'string' && data.photoURL ? data.photoURL : null;
    const profile: Profile = { name, photoURL };
    // Discovery fields are optional; tolerate their absence or malformed values.
    if (Array.isArray(data.interests)) {
      const interests = data.interests.filter((x): x is string => typeof x === 'string');
      if (interests.length) profile.interests = interests;
    }
    if (typeof data.headline === 'string' && data.headline.trim()) {
      profile.headline = data.headline.trim();
    }
    return profile;
  } catch {
    return null;
  }
}

export interface UploadResult {
  url?: string;
  /** Firebase error code (e.g. 'storage/unauthorized') or a reason string. */
  error?: string;
  /** True when the failure was offline/transient — retry later, don't treat as fatal. */
  deferred?: boolean;
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
  const storageApp = app;
  const work = (async (): Promise<string> => {
    if (authReady) await authReady;
    const storage = getStorage(storageApp);
    const r = storageRef(storage, `profilePhotos/${peerId >>> 0}.jpg`);
    const blob = await uriToBlob(localUri);
    await uploadBytes(r, blob, { contentType: 'image/jpeg' });
    // RN blobs hold a native resource; release it.
    (blob as unknown as { close?: () => void }).close?.();
    return getDownloadURL(r);
  })();
  try {
    const res = await withTimeout(work, CLOUD_TIMEOUT_MS);
    if (res === TIMED_OUT) return { error: 'offline', deferred: true };
    return { url: res };
  } catch (e) {
    const code = (e as { code?: string })?.code ?? (e as Error)?.message ?? 'upload-failed';
    return { error: code, deferred: isOfflineCode(code) };
  }
}

export interface SaveResult {
  ok: boolean;
  /** Firestore error code (e.g. 'permission-denied', 'unavailable') when ok is false. */
  error?: string;
  /** True when the failure was offline/transient — retry later, don't treat as fatal. */
  deferred?: boolean;
}

/**
 * Write (merge) the local user's profile under its peerId. Returns the REAL
 * Firestore error code on failure ('permission-denied' → rules/auth,
 * 'unavailable' → network) so the UI can report the actual cause rather than
 * assuming one.
 */
export async function saveProfile(peerId: number, profile: Profile): Promise<SaveResult> {
  if (!ensureInit() || !db) return { ok: false, error: 'firebase-unconfigured' };
  try {
    if (authReady) await authReady;
    // Always write name/photo; write interests/headline explicitly (including the
    // empty/cleared cases) so a user can REMOVE them, since we merge.
    const docData: Record<string, unknown> = {
      name: profile.name.trim(),
      photoURL: profile.photoURL ?? null,
      interests: profile.interests ?? [],
      headline: profile.headline ?? '',
      updatedAt: serverTimestamp(),
    };
    const res = await withTimeout(setDoc(doc(db, PROFILES, String(peerId >>> 0)), docData, { merge: true }), CLOUD_TIMEOUT_MS);
    // A timeout means we're offline: the write is queued in the SDK for this session,
    // but treat it as deferred so the caller persists a pending sync for durability.
    if (res === TIMED_OUT) return { ok: false, error: 'offline', deferred: true };
    return { ok: true };
  } catch (e) {
    const code = (e as { code?: string })?.code ?? (e as Error)?.message ?? 'write-failed';
    return { ok: false, error: code, deferred: isOfflineCode(code) };
  }
}
