# Application directions

Where this technology can go, now that the core is proven: connectionless BLE
proximity + a small data channel, cross-platform (Android ↔ iOS), with an
optional identity backend and a synchronized shared visual moment.

This is a strategy note, not a spec. The first concrete build-out of Direction 1
is specified in `docs/DISCOVERY_SPEC.md`.

---

## What we actually built

Not "a light bridge." Underneath it is:

> A **serverless, cross-platform, offline, no-pairing, privacy-preserving
> proximity + small-data channel** between phones, with a **synchronized shared
> moment** rendered on top.

That combination is the differentiator. AirDrop, Bumble, Find My, contact-tracing
apps — nearly all of them need a backend, a cloud, or GPS. This needs **nothing
but two phones in a room**. The best applications lean into that; the worst throw
it away by bolting on a mandatory cloud.

Proven capabilities:

- Phone-to-phone discovery with **no pairing and no backend** for the core loop.
- Distance **banding** (~0.5–5 m), not a raw number.
- Optional **mutual-facing** detection (the compass ritual) — now a runtime
  toggle (`proximityMode`).
- A **24-byte payload** channel: identity, reactions, acks, small state.
- **Multi-peer** (N devices at once).
- Optional **identity backend** (name/photo today, keyed by a persistent peerId).
- An **AR-lite shared visual** that fires on both screens together.
- Works **offline / in RF-dense venues** where wifi and cell fail.

---

## The constraints that filter the ideas

Three properties of the current design decide what is viable. Ignore them and you
will design something the architecture can't deliver.

1. **Foreground-only** — no background BLE. This rules out passive / always-on
   ideas (ambient "crossed paths," contact tracing) unless a background service is
   added — hard on Android, and largely **impossible for iOS advertising**. Design
   for **both apps open, on purpose**.
2. **~5 m range, no bearing** — great for "we're in the same small space,"
   useless for "find them across the venue."
3. **The payload is full** — 23 of 24 bytes used (`docs/PAYLOAD_SPEC.md`). Rich
   per-user data (interests, headlines) must ride the **backend profile**, like
   name/photo already does — not the advertisement.
4. **Serverless P2P is the superpower** — any idea that *requires* a cloud to
   function has discarded the edge. Use the backend for enrichment, never as a
   dependency of the core moment.

Net: the sweet spot is **deliberate, in-the-moment, co-present interaction** —
not background, surveillance-style presence.

---

## Directions, best-fit first

### 1. Event / conference serendipity + icebreaker ⭐ top pick
Attendees publish interest tags; the app surfaces "someone nearby you should
meet" and the bridge becomes a literal *go say hi*. No badge scanning, no
organizer backend, works in a packed hall with dead wifi. Real buyer (event
organizers, sponsors); the bridge is a branded moment. Small feature delta —
interest tags on the profile + a discovery flow. **Specced in
`docs/DISCOVERY_SPEC.md`.**

### 2. Local serverless co-op play ⭐ best fit for the "whoa" mission
The payload is a peer-to-peer data channel. Two- or N-player games that *require*
physical presence: co-op puzzles, "pass the energy," synchronized rituals,
trivia, tag. Lowest-stakes way to validate retention — and there's a ready
vehicle in the **Aura Resonance** kindness game. "Stand near a stranger, complete
a tiny shared act" is on-brand.

### 3. Intentional meetups / privacy-first "we met"
Mutual opt-in; the face-to-face ritual *is* the meet-cute. Logs "we were actually
together" without GPS or a tracking backend — a privacy-respecting
counter-position to location-sharing social apps. The facing gate is the killer
feature here, not a nice-to-have.

### 4. Functional two-present confirmations
Bump-to-exchange-profile; proximity check-in / attendance (gym, class, workshop);
"both parties physically present" as a trust signal for a handoff, delivery, or
chaperoned meeting. Unglamorous, but obvious customers and full use of the
serverless property.

### 5. Installations / brand activations
Museum: two strangers at the same exhibit share a moment. Retail / experiential:
co-present AR at a product. Team-building. High "whoa," project-based revenue, and
where the current visual already shines.

---

## Recommendation

Chase a real purpose through **#1 or #2**, not both at once:

- For **validation + a business model** → the **event icebreaker** (Direction 1).
  Dense context, clear buyer, small feature delta. This is the one specced next.
- For **proving the magic retains people** (the original hypothesis) → a **co-op
  micro-game** on the Aura Resonance rails. Fastest path to "people come back."

Everything else (meetups, confirmations, installations) is reachable later from
either starting point.

---

## Ideas explicitly parked (and why)

- **Ambient "crossed paths" log / passive contact tracing** — needs background
  BLE; iOS advertising in the background is effectively impossible. Revisit only
  if a native background path is funded.
- **"Find my friend across the venue"** — needs bearing + longer range; this
  stack has neither. Would require UWB or Cloud Anchors (the documented upgrade
  path, not the PoC).
- **Rich messaging between phones** — the connectionless channel is best-effort
  and tiny; real messaging needs a GATT channel, a deliberate non-goal (§3.1).
