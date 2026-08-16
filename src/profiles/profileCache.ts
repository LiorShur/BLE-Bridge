/**
 * Local, offline-first cache of PEER profiles (name/photo/interests/headline),
 * keyed by peerId. Redundancy for the backend: once we've resolved a peer's
 * identity (from Firebase OR over GATT), we remember it on-device so it still
 * shows when Firebase is unreachable (no network, backend down) or on the next
 * cold launch before any fetch completes.
 *
 * The local user's OWN profile is persisted separately (identity/persistentId.ts);
 * this is only for OTHER people we've seen. Best-effort throughout: a storage
 * failure degrades to no cache, never an error.
 *
 * NOTE: depends on React Native (AsyncStorage); not part of the pure-logic suite.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'aurabridge.peerProfiles.v1';
// Cap the cache so a long-running install can't grow it without bound; the oldest
// (by last-seen time) are dropped first. A pilot sees far fewer than this.
const MAX_ENTRIES = 100;

export interface CachedPeerProfile {
  name?: string;
  photoURL?: string | null;
  interests?: string[];
  headline?: string;
  /** Last time we wrote this entry (ms), used for LRU trimming. */
  ts: number;
}

type CacheMap = Record<number, CachedPeerProfile>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Load the whole peer-profile cache. Returns {} on any problem. */
export async function loadPeerProfileCache(): Promise<CacheMap> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const out: CacheMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      const id = Number.parseInt(k, 10);
      if (!Number.isInteger(id) || !isRecord(v)) continue;
      const name = typeof v.name === 'string' ? v.name : undefined;
      const photoURL = typeof v.photoURL === 'string' ? v.photoURL : undefined;
      if (!name && !photoURL) continue; // nothing worth caching
      const interests = Array.isArray(v.interests)
        ? v.interests.filter((x): x is string => typeof x === 'string')
        : undefined;
      const headline = typeof v.headline === 'string' ? v.headline : undefined;
      const ts = typeof v.ts === 'number' ? v.ts : 0;
      out[id >>> 0] = {
        ...(name ? { name } : {}),
        ...(photoURL !== undefined ? { photoURL } : {}),
        ...(interests && interests.length ? { interests } : {}),
        ...(headline ? { headline } : {}),
        ts,
      };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Merge one peer's resolved fields into the cache and persist. Only overwrites a
 * field we were given (a photo-only update keeps the cached name, and vice versa),
 * so partial resolutions accumulate rather than clobber.
 */
export async function savePeerProfileToCache(
  peerId: number,
  p: { name?: string; photoURL?: string | null; interests?: string[]; headline?: string },
  now: number,
): Promise<void> {
  try {
    const map = await loadPeerProfileCache();
    const key = peerId >>> 0;
    const prev = map[key];
    const merged: CachedPeerProfile = {
      ...prev,
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.photoURL !== undefined ? { photoURL: p.photoURL } : {}),
      ...(p.interests !== undefined ? { interests: p.interests } : {}),
      ...(p.headline !== undefined ? { headline: p.headline } : {}),
      ts: now,
    };
    if (!merged.name && !merged.photoURL) return; // nothing worth storing
    map[key] = merged;

    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      // Drop the oldest by ts until back under the cap.
      keys
        .sort((a, b) => (map[Number(a)]?.ts ?? 0) - (map[Number(b)]?.ts ?? 0))
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((k) => delete map[Number(k)]);
    }
    await AsyncStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* best-effort — losing the cache only costs a re-fetch */
  }
}
