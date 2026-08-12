/**
 * Interest matching for the discovery feature (docs/DISCOVERY_SPEC.md §3).
 *
 * PURE functions: my interest ids + a peer's interest ids → the overlap and a
 * score. The React hook (useDiscovery) layers proximity-based ranking on top; the
 * scoring itself has no notion of radio or state and is fully unit tested.
 *
 * Score = count of shared tags (legible: "3 shared interests"). Ranking breaks
 * ties by proximity so the person you can actually walk to wins.
 */
import { normaliseInterests } from './interests';

/** Surface a proactive "you should meet" nudge at or above this many shared tags. */
export const NUDGE_MIN_SHARED = 2;

export interface MatchResult {
  peerId: number;
  /** Catalog ids in common, in the order they appear in *my* list. */
  shared: string[];
  /** Number of shared tags. */
  score: number;
}

/**
 * Shared interests between me and one peer. Unknown/duplicate ids on either side
 * are dropped first (via {@link normaliseInterests}); `shared` preserves *my*
 * ordering so the UI shows tags in a stable, self-consistent order.
 */
export function computeMatch(
  peerId: number,
  mine: readonly string[],
  theirs: readonly string[],
): MatchResult {
  const mineNorm = normaliseInterests(mine);
  const theirsSet = new Set(normaliseInterests(theirs));
  const shared = mineNorm.filter((id) => theirsSet.has(id));
  return { peerId, shared, score: shared.length };
}

/** True if a match is strong enough to interrupt with a proactive nudge (§3). */
export function isStrongMatch(m: MatchResult): boolean {
  return m.score >= NUDGE_MIN_SHARED;
}

/** A peer with a match and a proximity band, ready to rank (§3 ranking rule). */
export interface RankableCandidate {
  match: MatchResult;
  /** 0..1 from the bond engine; higher = closer. */
  proximity: number;
}

/**
 * Rank candidates for the "people nearby" list: more shared tags first, then
 * closer first. Peers with no shared interests (score 0) are kept — the UI may
 * still list them below matches — callers filter if they want matches only.
 * Does not mutate the input.
 */
export function rankCandidates<T extends RankableCandidate>(candidates: readonly T[]): T[] {
  return [...candidates].sort((a, b) => {
    if (b.match.score !== a.match.score) return b.match.score - a.match.score;
    return b.proximity - a.proximity;
  });
}
