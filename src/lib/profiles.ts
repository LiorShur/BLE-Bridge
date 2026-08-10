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
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { initializeAuth, getReactNativePersistence, signInAnonymously, type Auth } from 'firebase/auth';
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

function ensureInit(): boolean {
  if (!isFirebaseConfigured()) return false;
  if (app) return true;
  try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
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
