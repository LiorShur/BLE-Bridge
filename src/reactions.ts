/**
 * Reaction catalog — the small set of "sends" a bonded pair can exchange over
 * the BLE broadcast (payload bytes 12–17). IDs are the wire values; 0 means
 * "no reaction". Keep this list ≤ 255 and stable — the id is what goes on the
 * wire. Pure and unit-tested.
 */
export interface Reaction {
  /** Wire id (1..255); 0 is "none". */
  id: number;
  emoji: string;
  label: string;
}

export const REACTIONS: readonly Reaction[] = [
  { id: 1, emoji: '❤️', label: 'love' },
  { id: 2, emoji: '👋', label: 'wave' },
  { id: 3, emoji: '✨', label: 'spark' },
  { id: 4, emoji: '😂', label: 'laugh' },
  { id: 5, emoji: '🔥', label: 'fire' },
  { id: 6, emoji: '🎉', label: 'party' },
] as const;

export function reactionById(id: number): Reaction | undefined {
  return REACTIONS.find((r) => r.id === id);
}
