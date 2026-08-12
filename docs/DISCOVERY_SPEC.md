# Discovery spec — "someone nearby you should meet"

The first concrete build-out of Direction 1 in `docs/APPLICATIONS.md`: turn the
bridge into a **serendipity + icebreaker** tool. You walk into an event, and the
app quietly tells you *which* nearby person is worth crossing the room for — then
the bridge is the "go say hi," and it hands you an opener.

Status: **D0–D3 built** (payload hints, the pure matching brain, profile
authoring, and the discovery runtime + "People nearby" sheet). D4 (meeting
polish — icebreaker-on-bond, warm-tint beam) is still spec; note the icebreaker
already appears on strong-match cards in the sheet. Scoped to fit the existing
architecture with the smallest possible change.

---

## 1. The core constraint (read first)

**The BLE payload is full.** 23 of 24 bytes are used (`docs/PAYLOAD_SPEC.md §2`).
Interest tags — a handful of short strings per person — do **not** fit on the
wire, and trying to cram them there would mean a version bump, extended
advertising, or dropping existing fields. None of that is worth it.

So interests ride the **backend profile**, exactly like `name`/`photoURL` already
do (`docs/PROFILES.md`). The wire gains only **two tiny, backward-compatible
hints** that let a device decide *whether to bother fetching* a peer's profile:

| Wire change | Where | Meaning |
|---|---|---|
| `LOOKING_TO_MEET` | `flags` bit 3 (`0x08`, currently reserved) | This user is in discovery mode and open to meeting strangers — distinct from bit 0 `AVAILABLE` (open to bridging). |
| `interestBucket` | byte 23 (currently `reserved`) | uint8 coarse primary-interest category, `0` = unset. A cheap pre-filter so you can rank/nudge *before* a backend round-trip. |

Both are forward-compatible for free: a build predating them reads bit 3 as 0 and
byte 23 as 0 and ignores both (`PAYLOAD_SPEC.md §6` already mandates tolerating
reserved bits/bytes). **No version bump.**

Everything richer than the coarse bucket — the actual tag list, a one-line
headline — lives in Firestore and is fetched out-of-band, the same mechanism that
already fetches name/photo on bond.

---

## 2. Data model

### 2.1 Extend the profile document

`profiles/{peerId}` gains two optional fields:

```ts
export interface Profile {
  name: string;
  photoURL: string | null;
  interests?: string[];   // 0..8 tag ids from the catalog (§2.2)
  headline?: string;      // optional one-liner, <= 60 chars ("building a BLE toy")
}
```

- `interests` are **catalog ids**, not free text — so matching is exact and the
  UI can localise labels. Cap at 8 (keeps the doc small and matching cheap).
- Firestore rules extend the existing `name` validation: `interests` is a list of
  strings, size ≤ 8; `headline` is a string, size ≤ 60. (See `PROFILES.md` for
  the current rules block to amend.)

### 2.2 Interest catalog

A curated, versioned taxonomy in `src/discovery/interests.ts` (pure data, unit
tested), mirroring `src/reactions.ts`:

```ts
export interface Interest {
  id: string;        // stable, e.g. 'climbing'  (never renumbered)
  label: string;     // 'Rock climbing'
  bucket: number;    // 1..255 coarse category for the wire hint (§2.3)
  emoji: string;     // '🧗'
}
```

- ~40–60 tags for v0, grouped under ~12 buckets (Tech, Music, Sport, Outdoors,
  Art, Food, Games, Books, Film, Science, Business, Wellness…).
- `id` is permanent; labels/emoji can change. New tags append only.

### 2.3 The coarse `interestBucket` on the wire

The single wire byte carries the user's **primary** interest's `bucket` (they pick
one favourite; `0` if none). It is a *hint*, not the match — it lets a scanner
cheaply say "that looking-to-meet person's headline interest is in my top bucket"
and prioritise fetching their profile. The real match is computed from the full
`interests[]` after the fetch.

---

## 3. Matching

Pure function, `src/discovery/match.ts`, unit tested against fixtures:

```ts
interface MatchResult {
  peerId: number;
  shared: string[];      // catalog ids in common
  score: number;         // shared.length (tie-broken by proximity upstream)
}
computeMatch(mine: string[], theirs: string[]): MatchResult
```

- Score = **count of shared tags** (simple, legible; Jaccard is an option later
  but overlap count reads better in the UI: "3 shared interests").
- Ranking of the nearby list (in the hook, not the pure fn) = sort by
  `(score desc, proximity desc)` — closeness breaks ties so the person you can
  actually walk to wins.
- **Nudge threshold**: surface a proactive "you should meet" prompt when
  `score ≥ 2` **and** the peer is at least in the *close* proximity band. One tag
  in common is shown passively in the list but doesn't interrupt.

---

## 4. The flow

### 4.1 Setup (once)
Onboarding gains a step after the profile screen:
1. Pick interests from the catalog (multi-select, cap 8) + choose one **primary**.
2. Optional one-line headline.
3. A **"Looking to meet"** switch (the discovery mode). **Default OFF** — see §6.

Writes `interests`, `headline`, primary → `interestBucket` to the profile;
the switch sets the `LOOKING_TO_MEET` flag on the local advertisement.

### 4.2 Discovery (live, both apps open)
While `LOOKING_TO_MEET` is on:
- The scan already yields every nearby peer. For each nearby peer **that also
  advertises `LOOKING_TO_MEET`**, fetch+cache its profile (extend
  `useProfiles` to cover looking peers, not only bonded ones). The
  `interestBucket` hint lets us fetch high-bucket-overlap peers first if we ever
  need to rate-limit.
- Compute `computeMatch` against my interests; rank.

### 4.3 Surface
A **"People nearby"** sheet (new `src/features` UI, distinct from the bridge):
- One card per looking peer: photo, name, headline, **shared-tag chips**
  ("🧗 Climbing · 🎬 Film"), and a proximity label ("very close / nearby").
- Ranked by §3. A strong match (`score ≥ 2`, close) gets a gentle top-of-screen
  nudge: *"3 shared interests nearby — go say hi."*
- Optional: the bridge beam for a strong-match peer tints/pulses warmer, so the
  AR view itself points you at the right person without a separate screen.

### 4.4 The meeting
- Walk together → the bridge forms (proximity or face-to-face per the toggle) —
  now the shared moment *means* something because you know why.
- On bond, show an **icebreaker** derived from a shared tag:
  `src/discovery/icebreakers.ts` maps each catalog id → a few opener templates
  ("You both like bouldering — ask where they climb"). Static for v0; an LLM can
  generate these later, but templates keep it offline and safe.

### 4.5 After
- Nothing is persisted about who you met unless a user explicitly saves a contact
  (out of scope for v0). Discovery is ephemeral by default (§6).

---

## 5. Module map (new + touched)

```
src/discovery/
  interests.ts        catalog (pure data) + lookups          [new, tested]
  match.ts            computeMatch, ranking helpers (pure)    [new, tested]
  icebreakers.ts      catalog id -> opener templates (pure)   [new, tested]
  useDiscovery.ts     nearby looking-peers -> ranked matches  [new, RN]
src/features/nearby/
  NearbySheet.tsx     the "people nearby" UI                  [new, RN]
src/ble/payload.ts    + LOOKING_TO_MEET flag, + interestBucket byte  [touched, tested]
src/lib/profiles.ts   Profile gains interests?/headline?; fetch/save  [touched]
src/profiles/useProfiles.ts  fetch looking peers, not just bonded     [touched]
src/screens/ProfileScreen.tsx  interest picker + headline + looking switch [touched]
src/state/store.ts    lookingToMeet flag, myInterests, matches         [touched]
```

Pure, unit-testable without hardware (CLAUDE.md §7/§8): the catalog, `match.ts`,
`icebreakers.ts`, and the payload codec round-trip for the two new fields
(including old-build tolerance: bit 3 / byte 23 read as 0).

---

## 6. Privacy & safety (non-negotiable for this feature)

Broadcasting "I'm open to meeting" plus interests has real-world stakes; treat it
like the safety rails in the sibling projects.

- **Discovery is opt-in and OFF by default.** No `LOOKING_TO_MEET`, no discovery
  fetches, until the user flips the switch. The bridge works fully without it.
- **Invisible ≠ blind.** A user can browse nearby people without being looking
  themselves? No — reciprocity by design: you only appear in others' lists while
  you are also looking. This avoids a lurker asymmetry.
- **On the wire we leak only a coarse bucket + one flag bit** — never names or
  tag lists. The advertisement is observable by anyone in range (§3.1), so
  nothing sensitive rides it. Full tags require fetching a profile the user chose
  to publish.
- **No history.** v0 keeps no record of who was near you or whom you met. No
  location is ever read (there is none in this stack) — a genuine privacy edge
  over GPS apps, and we should keep it.
- **Easy exit.** One tap turns discovery off and clears the local matches.
- **Block/again-later** is out of scope for v0 but the opt-in + reciprocity model
  is the foundation for it.

---

## 7. Phasing

- **D0 — payload hints.** ✅ `FLAG_LOOKING_TO_MEET` (flags bit 3) +
  `interestBucket` (byte 23) added to `payload.ts` with codec tests, including
  old-build tolerance (a 23-byte packet decodes the bucket as 0). No behaviour
  wired yet. `PAYLOAD_SPEC.md §5/§10` updated.
- **D1 — catalog + match + icebreakers.** ✅ `src/discovery/interests.ts`
  (12 buckets, ~50 tags), `match.ts` (`computeMatch` + `rankCandidates`), and
  `icebreakers.ts` (seeded, deterministic) — all pure, 25 unit tests, no UI and no
  backend. The whole matching "brain," verifiable off-device.
- **D2 — profile authoring.** ✅ Interest picker (first pick = primary ★),
  headline, and a "Looking to meet" switch in `ProfileScreen`. `Profile` extended
  with `interests`/`headline` (fetch + save); persisted locally and to Firestore.
  Advertiser + iOS peripheral now set `FLAG_LOOKING_TO_MEET` and the primary's
  `interestBucket` when looking. **Firestore rules still need the `interests`/
  `headline` allowances added (see §2.1 / PROFILES.md) — owner action.**
- **D3 — discovery runtime + Nearby sheet.** ✅ `useDiscovery` ranks nearby
  LOOKING peers (reciprocity-gated) by shared interests then proximity;
  `features/nearby/NearbySheet.tsx` renders the ranked cards (shared-tag chips,
  proximity, strong-match highlight + icebreaker) with the live looking switch. A
  "✨ Nearby/Meet" tab in the main view opens it and badges strong matches.
- **D4 — meeting polish.** Icebreaker on bond (the beam moment itself); optional
  warm-tint on the strong-match beam. *(Icebreakers already surface on strong
  cards in the sheet.)*

Each phase is demonstrable alone; D0–D1 need no hardware and no backend.

---

## 8. Open questions for the owner

1. **Catalog authorship** — who curates the ~50 tags? A generic starter set is
   fine for a first test; an event-specific set ("which track are you on") may
   convert better.
2. **Reciprocity** (§6) — confirm the "you only see others while you're also
   visible" rule. It's the safe default but reduces passive browsing.
3. **Nudge aggressiveness** — `score ≥ 2` + close is a starting threshold; tune on
   real event density (too low = spammy in a crowd).
4. **Icebreakers**: static templates for v0 (offline, safe) vs. LLM-generated
   (richer, needs a function + guardrails). Recommend static first.
