/**
 * Discovery visibility semantics (docs/DISCOVERY_SPEC.md §6) — PURE + unit tested.
 *
 * Decouples three things the old boolean conflated: being visible to others,
 * seeing others, and being nudged. The store holds the selected {@link Visibility}
 * and the rest of the app asks these predicates rather than switching on the mode.
 *
 *   mode      broadcast(visible)  browse(see others)  proactive nudge
 *   off              –                   –                  –
 *   open             ✓                   ✓                  ✓
 *   curious          ✓                   ✓                  –   (visible, low-key)
 *   ghost            –                   ✓                  –   (browse unseen)
 *
 * `ghost` deliberately breaks reciprocity (see without being seen) — a lurker mode
 * the base design avoided; exposed as an explicit user choice, off by default.
 */
export type Visibility = 'off' | 'open' | 'curious' | 'ghost';

/** Whether this mode broadcasts LOOKING_TO_MEET (i.e. is visible to others). */
export function isBroadcasting(v: Visibility): boolean {
  return v === 'open' || v === 'curious';
}

/** Whether this mode surfaces a nearby list to the local user. */
export function isBrowsing(v: Visibility): boolean {
  return v !== 'off';
}

/** Whether this mode raises a proactive nudge (the ✨ badge) on strong matches. */
export function showsNudges(v: Visibility): boolean {
  return v === 'open';
}

/** UI copy for each mode, in display order — shared by the profile screen + sheet. */
export interface VisibilityOption {
  mode: Visibility;
  label: string;
  emoji: string;
  desc: string;
}

export const VISIBILITY_OPTIONS: readonly VisibilityOption[] = [
  { mode: 'open', emoji: '📡', label: 'Open', desc: "Visible to others, and nudged when someone nearby is a strong match." },
  { mode: 'curious', emoji: '👀', label: 'Curious', desc: 'Visible to others, but browse at your own pace — no pop-ups.' },
  { mode: 'ghost', emoji: '🕶️', label: 'Ghost', desc: 'Browse people nearby without appearing to them.' },
  { mode: 'off', emoji: '🚫', label: 'Off', desc: 'Not discoverable; discovery hidden.' },
] as const;
