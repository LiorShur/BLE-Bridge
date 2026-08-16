/**
 * Icebreaker openers for the discovery feature (docs/DISCOVERY_SPEC.md §4.4).
 *
 * On bond, given the tags two people share, produce a one-line opener. PURE and
 * deterministic — no Math.random (which is unavailable in this codebase's pure
 * layer anyway): the caller passes a `seed` (e.g. the peerId) so the same pair
 * gets a stable suggestion instead of one that flickers each render. Unit tested.
 *
 * v0 is template-based (offline, safe). An LLM could generate richer openers
 * later behind a Cloud Function — the call site stays the same.
 */
import { interestById } from './interests';

/**
 * Generic openers, parameterised by the shared interest's label. Cover every tag
 * without bespoke copy. `{x}` is replaced by the lower-cased label.
 */
const GENERIC_TEMPLATES: readonly string[] = [
  'You both like {x} — ask how they got into it.',
  'Shared interest: {x}. Swap a recommendation.',
  "You're both into {x} — compare notes.",
  'Break the ice: {x}. What got them started?',
];

/** A few bespoke openers for common tags, chosen over the generic set when present. */
const SPECIFIC_TEMPLATES: Readonly<Record<string, readonly string[]>> = {
  climbing: ['You both climb — trade favourite crags or gyms.', 'Ask them: bouldering or ropes?'],
  coffee: ['You both love coffee — argue about the best local roaster.'],
  running: ['You both run — compare routes or a next race.'],
  scifi: ['You both read sci-fi — swap the last great book.'],
  boardgames: ['You both play board games — find one you both love.'],
  travel: ['You both travel — ask about their best trip this year.'],
  cooking: ['You both cook — trade a dish worth stealing.'],
  ai: ['You both follow AI — what are they excited (or worried) about?'],
  'live-music': ['You both go to gigs — last show you saw?'],
  photography: ['You both shoot — phone or camera person?'],
};

function fill(template: string, label: string): string {
  return template.replace('{x}', label.toLowerCase());
}

/** Pick a template by seed; falls back to the first entry (never undefined). */
function pick(templates: readonly string[], seed: number): string {
  return templates[seed % templates.length] ?? templates[0] ?? '';
}

/**
 * An opener for a pair, from the interests they share. Picks the FIRST shared tag
 * (the caller passes them in match order, so this is the strongest/most-relevant),
 * then selects deterministically from its templates by `seed`. Returns `null`
 * when there are no (known) shared tags to riff on.
 *
 * @param shared catalog ids in common, in priority order
 * @param seed   stable selector (e.g. peerId) so the suggestion doesn't flicker
 */
export function icebreakerFor(shared: readonly string[], seed: number): string | null {
  const safeSeed = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) : 0;
  for (const id of shared) {
    const interest = interestById(id);
    if (!interest) continue; // unknown id — skip, try the next shared tag
    const specific = SPECIFIC_TEMPLATES[id];
    if (specific && specific.length > 0) {
      return pick(specific, safeSeed);
    }
    return fill(pick(GENERIC_TEMPLATES, safeSeed), interest.label);
  }
  return null;
}
