/**
 * Selector hook: the current nearby peers as debug rows (CLAUDE.md §5).
 *
 * The scan loop and fusion are owned by `useBondEngine`; this hook simply
 * exposes the resulting per-peer rows (keyed on payload `peerId`) for any view
 * that wants the list. Kept thin so there is exactly one scanner in the app.
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import { useStore } from '../state/store.js';
import type { PeerDebugRow } from '../signal/engine.js';

export function useNearbyPeers(): PeerDebugRow[] {
  return useStore((s) => s.peerRows);
}
