/**
 * Interest catalog for the discovery feature (docs/DISCOVERY_SPEC.md §2.2).
 *
 * A curated, versioned taxonomy — mirrors src/reactions.ts. Interests are stored
 * on the backend profile by their stable `id` (never on the BLE wire; the payload
 * is full — DISCOVERY_SPEC §1). Only the coarse `bucket` of a user's PRIMARY
 * interest rides the wire, as the byte-23 pre-filter hint (payload.ts).
 *
 * PURE data + lookups, no I/O — unit tested. Rules:
 *   - `id` is permanent: never renumber or repurpose. New tags append only.
 *   - `bucket` is 1..255 (0 = unset on the wire); groups tags into coarse
 *     categories for the pre-filter. Labels/emoji may change freely.
 */

/** A coarse category; its numeric id is what a user's PRIMARY tag puts on the wire. */
export interface Bucket {
  /** Wire value 1..255 (0 = unset). Stable. */
  id: number;
  label: string;
  emoji: string;
}

export interface Interest {
  /** Stable tag id stored on the profile. Never renumbered. */
  id: string;
  label: string;
  /** The {@link Bucket} this tag rolls up to. */
  bucket: number;
  emoji: string;
}

export const BUCKETS: readonly Bucket[] = [
  { id: 1, label: 'Tech', emoji: '💻' },
  { id: 2, label: 'Music', emoji: '🎵' },
  { id: 3, label: 'Sport', emoji: '⚽' },
  { id: 4, label: 'Outdoors', emoji: '🏔️' },
  { id: 5, label: 'Art', emoji: '🎨' },
  { id: 6, label: 'Food', emoji: '🍜' },
  { id: 7, label: 'Games', emoji: '🎮' },
  { id: 8, label: 'Books', emoji: '📚' },
  { id: 9, label: 'Film', emoji: '🎬' },
  { id: 10, label: 'Science', emoji: '🔬' },
  { id: 11, label: 'Business', emoji: '💼' },
  { id: 12, label: 'Wellness', emoji: '🧘' },
] as const;

export const INTERESTS: readonly Interest[] = [
  // Tech (1)
  { id: 'ai', label: 'AI / ML', bucket: 1, emoji: '🤖' },
  { id: 'webdev', label: 'Web dev', bucket: 1, emoji: '🌐' },
  { id: 'hardware', label: 'Hardware / making', bucket: 1, emoji: '🔧' },
  { id: 'crypto', label: 'Crypto / web3', bucket: 1, emoji: '⛓️' },
  { id: 'startups', label: 'Startups', bucket: 1, emoji: '🚀' },
  // Music (2)
  { id: 'live-music', label: 'Live music', bucket: 2, emoji: '🎤' },
  { id: 'producing', label: 'Producing / DJing', bucket: 2, emoji: '🎛️' },
  { id: 'jazz', label: 'Jazz', bucket: 2, emoji: '🎷' },
  { id: 'guitar', label: 'Playing guitar', bucket: 2, emoji: '🎸' },
  // Sport (3)
  { id: 'running', label: 'Running', bucket: 3, emoji: '🏃' },
  { id: 'football', label: 'Football', bucket: 3, emoji: '⚽' },
  { id: 'cycling', label: 'Cycling', bucket: 3, emoji: '🚴' },
  { id: 'yoga', label: 'Yoga', bucket: 3, emoji: '🧘' },
  { id: 'martial-arts', label: 'Martial arts', bucket: 3, emoji: '🥋' },
  // Outdoors (4)
  { id: 'hiking', label: 'Hiking', bucket: 4, emoji: '🥾' },
  { id: 'climbing', label: 'Rock climbing', bucket: 4, emoji: '🧗' },
  { id: 'camping', label: 'Camping', bucket: 4, emoji: '🏕️' },
  { id: 'surfing', label: 'Surfing', bucket: 4, emoji: '🏄' },
  // Art (5)
  { id: 'painting', label: 'Painting / drawing', bucket: 5, emoji: '🖌️' },
  { id: 'photography', label: 'Photography', bucket: 5, emoji: '📷' },
  { id: 'design', label: 'Design', bucket: 5, emoji: '✏️' },
  { id: 'ceramics', label: 'Ceramics', bucket: 5, emoji: '🏺' },
  // Food (6)
  { id: 'cooking', label: 'Cooking', bucket: 6, emoji: '🍳' },
  { id: 'coffee', label: 'Coffee', bucket: 6, emoji: '☕' },
  { id: 'baking', label: 'Baking', bucket: 6, emoji: '🥐' },
  { id: 'wine', label: 'Wine', bucket: 6, emoji: '🍷' },
  // Games (7)
  { id: 'video-games', label: 'Video games', bucket: 7, emoji: '🎮' },
  { id: 'boardgames', label: 'Board games', bucket: 7, emoji: '🎲' },
  { id: 'ttrpg', label: 'Tabletop RPGs', bucket: 7, emoji: '🐉' },
  { id: 'chess', label: 'Chess', bucket: 7, emoji: '♟️' },
  // Books (8)
  { id: 'scifi', label: 'Sci-fi', bucket: 8, emoji: '👽' },
  { id: 'fantasy', label: 'Fantasy', bucket: 8, emoji: '🗡️' },
  { id: 'nonfiction', label: 'Non-fiction', bucket: 8, emoji: '📖' },
  { id: 'poetry', label: 'Poetry', bucket: 8, emoji: '🖋️' },
  // Film (9)
  { id: 'cinema', label: 'Cinema', bucket: 9, emoji: '🎬' },
  { id: 'anime', label: 'Anime', bucket: 9, emoji: '🍥' },
  { id: 'documentaries', label: 'Documentaries', bucket: 9, emoji: '🎥' },
  // Science (10)
  { id: 'space', label: 'Space / astronomy', bucket: 10, emoji: '🔭' },
  { id: 'biology', label: 'Biology / nature', bucket: 10, emoji: '🧬' },
  { id: 'psychology', label: 'Psychology', bucket: 10, emoji: '🧠' },
  { id: 'physics', label: 'Physics', bucket: 10, emoji: '⚛️' },
  // Business (11)
  { id: 'entrepreneurship', label: 'Entrepreneurship', bucket: 11, emoji: '📈' },
  { id: 'investing', label: 'Investing', bucket: 11, emoji: '💹' },
  { id: 'marketing', label: 'Marketing', bucket: 11, emoji: '📣' },
  { id: 'product', label: 'Product', bucket: 11, emoji: '🧩' },
  // Wellness (12)
  { id: 'meditation', label: 'Meditation', bucket: 12, emoji: '🧘' },
  { id: 'volunteering', label: 'Volunteering', bucket: 12, emoji: '🤝' },
  { id: 'gardening', label: 'Gardening', bucket: 12, emoji: '🌱' },
  { id: 'travel', label: 'Travel', bucket: 12, emoji: '✈️' },
] as const;

/** Max interests a user may pick (keeps the profile doc + matching small). */
export const MAX_INTERESTS = 8;

const BY_ID = new Map(INTERESTS.map((i) => [i.id, i]));
const BUCKET_BY_ID = new Map(BUCKETS.map((b) => [b.id, b]));

export function interestById(id: string): Interest | undefined {
  return BY_ID.get(id);
}

export function bucketById(id: number): Bucket | undefined {
  return BUCKET_BY_ID.get(id);
}

/** True if every id is a known catalog tag. */
export function isValidInterestId(id: string): boolean {
  return BY_ID.has(id);
}

/** Drop unknown/duplicate ids, preserving order — use before storing/matching. */
export function normaliseInterests(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (BY_ID.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
    if (out.length >= MAX_INTERESTS) break;
  }
  return out;
}

/**
 * The wire `interestBucket` byte for a chosen primary interest id.
 * Returns 0 (unset) for a missing/unknown id, which the codec treats as "no hint".
 */
export function bucketForPrimary(primaryId: string | null | undefined): number {
  if (!primaryId) return 0;
  return BY_ID.get(primaryId)?.bucket ?? 0;
}
