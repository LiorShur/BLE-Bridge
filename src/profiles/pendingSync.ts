/**
 * Pending cloud sync for the LOCAL user's own profile.
 *
 * Writes are local-first: the profile is always saved to device storage
 * immediately (identity/persistentId.ts), and the cloud (Firestore/Storage) is
 * best-effort. When the cloud write can't complete (offline), we stash what still
 * needs to reach the backend here, and a background sync (useProfileSync.ts)
 * flushes it once connectivity returns — so a name/photo changed on a plane lands
 * in the cloud the moment there's signal again, with no user action.
 *
 * NOTE: depends on React Native (AsyncStorage); not part of the pure-logic suite.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'aurabridge.pendingProfileSync.v1';

export interface PendingProfile {
  peerId: number;
  name: string;
  interests: string[];
  headline: string | null;
  /** A resolved cloud photo URL, if the upload already succeeded. */
  photoURL: string | null;
  /** A local image URI still needing upload (set when the Storage upload was deferred). */
  photoLocalUri: string | null;
  /** When this was queued (ms). */
  ts: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Queue (replace) the profile that still needs to reach the cloud. */
export async function setPendingProfileSync(p: PendingProfile): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* best-effort */
  }
}

/** The profile awaiting cloud sync, or null if none. */
export async function getPendingProfileSync(): Promise<PendingProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (!isRecord(v) || typeof v.peerId !== 'number' || typeof v.name !== 'string') return null;
    return {
      peerId: v.peerId >>> 0,
      name: v.name,
      interests: Array.isArray(v.interests) ? v.interests.filter((x): x is string => typeof x === 'string') : [],
      headline: typeof v.headline === 'string' ? v.headline : null,
      photoURL: typeof v.photoURL === 'string' ? v.photoURL : null,
      photoLocalUri: typeof v.photoLocalUri === 'string' ? v.photoLocalUri : null,
      ts: typeof v.ts === 'number' ? v.ts : 0,
    };
  } catch {
    return null;
  }
}

/** Clear the pending sync (call after a successful flush). */
export async function clearPendingProfileSync(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* best-effort */
  }
}
