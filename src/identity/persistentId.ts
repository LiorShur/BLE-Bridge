/**
 * Persistent identity — makes `peerId` survive app restarts so it can double as
 * the profile key (src/lib/profiles.ts).
 *
 * CLAUDE.md §3.3 says peerId is "generated once per app install"; originally it
 * lived only in memory. Persisting it in AsyncStorage keeps that contract and
 * lets a peer's name/photo remain attached across launches. If storage is
 * unavailable we fall back to a fresh in-memory id — identity still works for the
 * session, only cross-launch profile stability is lost.
 *
 * NOTE: depends on React Native (AsyncStorage); not part of the pure-logic suite.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generatePeerId, PEER_ID_UNSET } from '../ble/identity';

const PEER_ID_KEY = 'aurabridge.peerId';
const MY_NAME_KEY = 'aurabridge.profile.name';
const MY_PHOTO_KEY = 'aurabridge.profile.photoURL';

/** Load the stored peerId, or generate + persist a new one. Never returns 0. */
export async function loadOrCreatePeerId(): Promise<number> {
  try {
    const stored = await AsyncStorage.getItem(PEER_ID_KEY);
    if (stored !== null) {
      const parsed = Number.parseInt(stored, 10);
      if (Number.isInteger(parsed) && parsed !== PEER_ID_UNSET && parsed >>> 0 === parsed) {
        return parsed;
      }
    }
    const fresh = generatePeerId();
    await AsyncStorage.setItem(PEER_ID_KEY, String(fresh));
    return fresh;
  } catch {
    return generatePeerId(); // storage denied — session-only id
  }
}

export interface StoredProfile {
  name: string | null;
  photoURL: string | null;
}

/** Load the local user's own saved profile (for prefilling the setup screen). */
export async function loadMyProfile(): Promise<StoredProfile> {
  try {
    const [name, photoURL] = await Promise.all([
      AsyncStorage.getItem(MY_NAME_KEY),
      AsyncStorage.getItem(MY_PHOTO_KEY),
    ]);
    return { name: name ?? null, photoURL: photoURL ?? null };
  } catch {
    return { name: null, photoURL: null };
  }
}

/** Persist the local user's own profile locally (mirrors what we wrote to Firebase). */
export async function saveMyProfileLocal(profile: StoredProfile): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [MY_NAME_KEY, profile.name ?? ''],
      [MY_PHOTO_KEY, profile.photoURL ?? ''],
    ]);
  } catch {
    /* best-effort */
  }
}
