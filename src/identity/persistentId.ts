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
const MY_INTERESTS_KEY = 'aurabridge.profile.interests';
const MY_PRIMARY_KEY = 'aurabridge.profile.primaryInterest';
const MY_HEADLINE_KEY = 'aurabridge.profile.headline';
const MY_CATALOG_KEY = 'aurabridge.profile.catalog';
const MY_VISIBILITY_KEY = 'aurabridge.profile.visibility';

const VALID_VISIBILITY = new Set(['off', 'open', 'curious', 'ghost']);

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
  /** Discovery interest tag ids (catalog: src/discovery/interests.ts). */
  interests: string[];
  /** The primary interest whose bucket rides the wire (null = none). */
  primaryInterest: string | null;
  /** Optional one-line discovery headline. */
  headline: string | null;
  /** Active interest catalog id (per-event); null = use the default. */
  activeCatalogId: string | null;
  /** Discovery visibility mode ('off'|'open'|'curious'|'ghost'); null = default off. */
  visibility: string | null;
}

/** Load the local user's own saved profile (for prefilling the setup screen). */
export async function loadMyProfile(): Promise<StoredProfile> {
  try {
    const [name, photoURL, interestsRaw, primaryInterest, headline, activeCatalogId, visibility] = await Promise.all([
      AsyncStorage.getItem(MY_NAME_KEY),
      AsyncStorage.getItem(MY_PHOTO_KEY),
      AsyncStorage.getItem(MY_INTERESTS_KEY),
      AsyncStorage.getItem(MY_PRIMARY_KEY),
      AsyncStorage.getItem(MY_HEADLINE_KEY),
      AsyncStorage.getItem(MY_CATALOG_KEY),
      AsyncStorage.getItem(MY_VISIBILITY_KEY),
    ]);
    let interests: string[] = [];
    if (interestsRaw) {
      try {
        const parsed: unknown = JSON.parse(interestsRaw);
        if (Array.isArray(parsed)) interests = parsed.filter((x): x is string => typeof x === 'string');
      } catch {
        /* corrupt — treat as empty */
      }
    }
    return {
      name: name ?? null,
      photoURL: photoURL ?? null,
      interests,
      primaryInterest: primaryInterest || null,
      headline: headline || null,
      activeCatalogId: activeCatalogId || null,
      visibility: visibility && VALID_VISIBILITY.has(visibility) ? visibility : null,
    };
  } catch {
    return { name: null, photoURL: null, interests: [], primaryInterest: null, headline: null, activeCatalogId: null, visibility: null };
  }
}

/** Persist the local user's own profile locally (mirrors what we wrote to Firebase). */
export async function saveMyProfileLocal(profile: StoredProfile): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [MY_NAME_KEY, profile.name ?? ''],
      [MY_PHOTO_KEY, profile.photoURL ?? ''],
      [MY_INTERESTS_KEY, JSON.stringify(profile.interests ?? [])],
      [MY_PRIMARY_KEY, profile.primaryInterest ?? ''],
      [MY_HEADLINE_KEY, profile.headline ?? ''],
      [MY_CATALOG_KEY, profile.activeCatalogId ?? ''],
      [MY_VISIBILITY_KEY, profile.visibility ?? ''],
    ]);
  } catch {
    /* best-effort */
  }
}
