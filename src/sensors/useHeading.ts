/**
 * Heading provider — Stage 1 STUB.
 *
 * Stage 1 ships without a compass dependency, so heading is reported as
 * unavailable (`null`). Per CLAUDE.md §4.3 the alignment math then falls back to
 * 1 and bonds form on proximity alone — the "face each other" gate returns in
 * Stage 2, when this is swapped for `useCompassHeading` and the compass dep is
 * added (see src/config.ts, BUILD.md).
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import { useEffect } from 'react';
import { useStore } from '../state/store';

export function useHeading(): void {
  const setLocalHeading = useStore((s) => s.setLocalHeading);
  useEffect(() => {
    setLocalHeading(null, 0); // no compass in Stage 1 → proximity-only bonding
  }, [setLocalHeading]);
}
