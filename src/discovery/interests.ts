/**
 * Interest catalogs for the discovery feature (docs/DISCOVERY_SPEC.md §2.2).
 *
 * A curated, versioned taxonomy — mirrors src/reactions.ts. Interests are stored
 * on the backend profile by their stable `id` (never on the BLE wire; the payload
 * is full — DISCOVERY_SPEC §1). Only the coarse `bucket` of a user's PRIMARY
 * interest rides the wire, as the byte-23 pre-filter hint (payload.ts).
 *
 * **Per-event catalogs.** There is ONE shared set of coarse {@link BUCKETS}
 * (universal categories — so the wire hint means the same thing everywhere), and
 * multiple {@link Catalog}s each supplying a curated interest set that maps into
 * those buckets. A device picks an active catalog (generic by default; an event
 * can ship its own). Matching is by interest `id`, which is globally unique across
 * catalogs — so two people only match on ids they both hold, i.e. within the same
 * catalog. Lookups (`interestById`, `normaliseInterests`, `bucketForPrimary`) work
 * against the UNION of all catalogs, so a peer's stored ids always resolve.
 *
 * PURE data + lookups, no I/O — unit tested. Rules:
 *   - `id` is permanent AND globally unique across catalogs. Namespace non-generic
 *     catalogs (e.g. `tc_ai`). Never renumber or repurpose. Append only.
 *   - `bucket` is 1..255 (0 = unset on the wire) and SHARED across catalogs.
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

const GENERIC_INTERESTS: readonly Interest[] = [
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

/**
 * Example EVENT catalog — a tech conference. Ids are namespaced `tc_*` (globally
 * unique) and map into the shared buckets. Ships as a proof of the mechanism; a
 * real event supplies its own set (tracks, "hiring/looking", etc.). Swapping the
 * active catalog is the whole per-event customization surface.
 */
const TECH_CONF_INTERESTS: readonly Interest[] = [
  // Tech (1)
  { id: 'tc_frontend', label: 'Frontend', bucket: 1, emoji: '🎨' },
  { id: 'tc_backend', label: 'Backend / infra', bucket: 1, emoji: '🗄️' },
  { id: 'tc_ml', label: 'AI / ML', bucket: 1, emoji: '🤖' },
  { id: 'tc_mobile', label: 'Mobile', bucket: 1, emoji: '📱' },
  { id: 'tc_security', label: 'Security', bucket: 1, emoji: '🔒' },
  { id: 'tc_devtools', label: 'Developer tools', bucket: 1, emoji: '🛠️' },
  { id: 'tc_data', label: 'Data / analytics', bucket: 1, emoji: '📊' },
  // Science (10)
  { id: 'tc_research', label: 'Research', bucket: 10, emoji: '🔬' },
  { id: 'tc_robotics', label: 'Robotics / hardware', bucket: 10, emoji: '🦾' },
  // Business (11)
  { id: 'tc_founder', label: 'Founder', bucket: 11, emoji: '🚀' },
  { id: 'tc_investor', label: 'Investor', bucket: 11, emoji: '💹' },
  { id: 'tc_pm', label: 'Product', bucket: 11, emoji: '🧩' },
  { id: 'tc_design', label: 'Design', bucket: 11, emoji: '✏️' },
  { id: 'tc_hiring', label: 'Hiring', bucket: 11, emoji: '🧑‍💼' },
  { id: 'tc_jobseeking', label: 'Looking for a role', bucket: 11, emoji: '🔎' },
  { id: 'tc_devrel', label: 'DevRel / community', bucket: 11, emoji: '📣' },
] as const;

/** A named interest set. Buckets are shared (module-level BUCKETS), not per-catalog. */
export interface Catalog {
  /** Stable catalog id (the value persisted as the device's active catalog). */
  id: string;
  label: string;
  interests: readonly Interest[];
}

export const CATALOGS: readonly Catalog[] = [
  { id: 'generic', label: 'General', interests: GENERIC_INTERESTS },
  { id: 'tech-conf', label: 'Tech conference', interests: TECH_CONF_INTERESTS },
] as const;

/** The catalog a device uses until the user picks another. */
export const DEFAULT_CATALOG_ID = 'generic';

/** Back-compat alias: the generic catalog's interests (the default picker set). */
export const INTERESTS = GENERIC_INTERESTS;

/** Max interests a user may pick (keeps the profile doc + matching small). */
export const MAX_INTERESTS = 8;

// Lookups resolve against the UNION of every catalog so a peer's stored ids always
// resolve regardless of which catalog they were picked from.
const ALL_INTERESTS: readonly Interest[] = CATALOGS.flatMap((c) => [...c.interests]);
const BY_ID = new Map(ALL_INTERESTS.map((i) => [i.id, i]));
const BUCKET_BY_ID = new Map(BUCKETS.map((b) => [b.id, b]));
const CATALOG_BY_ID = new Map(CATALOGS.map((c) => [c.id, c]));

export function interestById(id: string): Interest | undefined {
  return BY_ID.get(id);
}

export function bucketById(id: number): Bucket | undefined {
  return BUCKET_BY_ID.get(id);
}

/** True if the id is a known tag in ANY catalog. */
export function isValidInterestId(id: string): boolean {
  return BY_ID.has(id);
}

/** Look up a catalog by id (undefined if unknown). */
export function getCatalog(id: string): Catalog | undefined {
  return CATALOG_BY_ID.get(id);
}

/** The interests to show in the picker for a catalog (generic if unknown). */
export function catalogInterests(id: string): readonly Interest[] {
  return (CATALOG_BY_ID.get(id) ?? CATALOG_BY_ID.get(DEFAULT_CATALOG_ID))?.interests ?? GENERIC_INTERESTS;
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
