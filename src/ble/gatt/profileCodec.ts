/**
 * Serverless profile exchange over the GATT messaging channel
 * (docs/GATT_MESSAGING_SPEC.md §3) — PURE + unit tested.
 *
 * Encodes a peer's identity (name + discovery interests + headline) as a compact
 * UTF-8 JSON blob sent as a PROFILE message, so a bonded peer learns your name and
 * interests **with no backend** — the serverless alternative to the Firebase
 * profile fetch. Short keys keep it small; sizes are capped to mirror the Firestore
 * rules. Photo is deferred (too large for the v0 channel).
 */
import { utf8Encode, utf8Decode } from './utf8';

export interface GattProfile {
  name: string;
  interests: string[];
  headline?: string;
}

const MAX_NAME = 40;
const MAX_INTERESTS = 8;
const MAX_HEADLINE = 60;

/** Encode a profile to bytes (UTF-8 JSON with short keys), sizes capped. */
export function encodeProfile(p: GattProfile): Uint8Array {
  const doc = {
    n: p.name.slice(0, MAX_NAME),
    i: p.interests.filter((x) => typeof x === 'string').slice(0, MAX_INTERESTS),
    h: (p.headline ?? '').slice(0, MAX_HEADLINE),
  };
  return utf8Encode(JSON.stringify(doc));
}

/**
 * Decode a profile blob. Returns null (never throws) on malformed input or a
 * missing name — mirroring the codec discipline elsewhere. Applies the same caps.
 */
export function decodeProfile(bytes: Uint8Array): GattProfile | null {
  let doc: unknown;
  try {
    doc = JSON.parse(utf8Decode(bytes));
  } catch {
    return null;
  }
  if (typeof doc !== 'object' || doc === null) return null;
  const o = doc as { n?: unknown; i?: unknown; h?: unknown };
  const name = typeof o.n === 'string' ? o.n.trim().slice(0, MAX_NAME) : '';
  if (!name) return null;
  const interests = Array.isArray(o.i)
    ? o.i.filter((x): x is string => typeof x === 'string').slice(0, MAX_INTERESTS)
    : [];
  const headlineRaw = typeof o.h === 'string' ? o.h.trim().slice(0, MAX_HEADLINE) : '';
  const profile: GattProfile = { name, interests };
  if (headlineRaw) profile.headline = headlineRaw;
  return profile;
}
