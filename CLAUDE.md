# CLAUDE.md

Project context for Claude Code. Read this before touching any file.

> **Project name is a placeholder.** `AuraBridge` is used throughout for package
> names and identifiers. Rename before Phase 4 if a real name is chosen.

---

## 1. What this is

A proof of concept: two nearby Android phones discover each other over Bluetooth
Low Energy, and when their users stand close and face each other, an augmented
reality effect — a "bridge" of light between them — forms on both screens
simultaneously.

The goal is a **feeling**, not a measurement. This is a demo intended to make
someone say "whoa" when they try it with a friend. Technical accuracy matters
only insofar as it serves that.

### Non-goals for this PoC

Do not build these unless explicitly asked:

- iOS support (Android only — this removes most of the BLE complexity)
- GATT connections, pairing, or bonding (see §3.1 — the design is connectionless)
- Background operation (foreground only; screen on, app open)
- ~~More than two simultaneous peers (the data model allows N, the UI assumes 1)~~
  **Scope change (2026-08-09, owner request):** multiple simultaneous peers ARE
  now in scope. The signal layer already handled N; the UI renders all active
  bonds. Build order: get two devices solid first, then generalise the visual to N.
- ~~Accounts, backend, persistence, analytics~~
  **Scope change (2026-08-10, owner request):** an *optional* backend for peer
  identity is now in scope — a tiny public profile ({name, photoURL}) fetched on
  bond, keyed by a now-persistent `peerId` (Firebase JS SDK, anonymous auth). It
  degrades to the anonymous hue + #TAG when unconfigured/offline. Still no
  accounts and no analytics. The BLE payload is unchanged — identity still rides
  `peerId`; only the name/photo lookup is out-of-band.
- Cloud Anchors or UWB (these are the documented upgrade path, not the PoC)

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| App framework | React Native (bare, or Expo with dev build) | ViroReact does **not** run in Expo Go |
| AR | `@reactvision/react-viro` | Renders natively to ARCore |
| BLE scanning | `react-native-ble-plx` | Central role only; mature, reliable |
| BLE advertising | Custom Kotlin native module | See `docs/BLE_ADVERTISER_MODULE.md` |
| Sensors | `react-native-sensors` or a small native wrapper | Compass heading + accuracy |
| State | Zustand (or React context) | Small; do not add Redux |
| Language | TypeScript, strict mode | |

**Minimum SDK:** API 26 (Android 8.0). **Target:** current.

### Why a custom advertising module

The React Native ecosystem has no well-maintained BLE peripheral/advertiser
library. `react-native-ble-advertiser` exists but is patchily maintained and
abstracts away the exact controls this project needs (payload bytes, advertise
mode, connectable flag). The module we need is roughly 150 lines of Kotlin and
is fully specified in `docs/BLE_ADVERTISER_MODULE.md`. Write it; don't wrap
someone else's.

---

## 3. Architectural decisions

These were made deliberately. Do not reverse them without flagging it first.

### 3.1 Connectionless BLE

**Decision:** peers never connect. Each phone advertises and scans
simultaneously, and all shared data travels in the advertisement payload.

**Why:** a GATT connection introduces connection state, reconnection logic,
MTU negotiation, disconnect races, and role assignment (who is central, who is
peripheral). None of it is needed. Every scan result already carries both the
peer's payload *and* its RSSI, several times per second. When a peer walks
away, scan results simply stop arriving and the effect fades — graceful
degradation for free.

**Constraint this imposes:** ~24 usable payload bytes, one-way, no
acknowledgement. The payload spec in `docs/PAYLOAD_SPEC.md` is designed to fit.

Advertising is set **non-connectable** (`setConnectable(false)`). This is not an
oversight.

### 3.2 The alignment gate

**Decision:** direction to the peer is never computed. Instead, the effect only
manifests when the geometry *guarantees* the peer is roughly straight ahead.

**Why it works:** exchanging compass headings tells you which way each phone is
*facing*, not where the peer *is*. But when two people face each other, their
headings are approximately 180° apart. So: gate the effect on mutual opposition,
then render the bridge straight ahead from the camera. No bearing math required,
and the interaction becomes a deliberate ritual — two people must stand near
each other and turn to face each other — which is better design than a passive
proximity ping.

**Known limitation:** the heading is the phone's, not the person's. Both users
must hold the device upright in portrait, roughly aligned with their body. This
is acceptable — it's how you'd hold a phone to look through it anyway. Indoor
magnetic interference degrades headings; see the accuracy fallback in §4.3.

### 3.3 Identity lives in the payload, not the MAC address

Android randomises the advertiser's Bluetooth address periodically (roughly
every 15 minutes) and there is no supported way to disable this. **Never use
`device.id` from a scan result as peer identity** — it will silently change
mid-session and your peer will appear to vanish and be replaced by a stranger.

Peer identity is the 4-byte `peerId` field in the payload, generated once per
app install and held in memory for the session.

### 3.4 Everything downstream reads two numbers

The BLE layer, the signal layer, and the AR layer are decoupled by a single
small interface. The AR scene knows nothing about Bluetooth.

```ts
interface BondState {
  proximity: number;   // 0..1, derived from smoothed RSSI
  alignment: number;   // 0..1, derived from mutual heading opposition
  strength: number;    // 0..1, the hysteresis-smoothed product
  bonded: boolean;     // has crossed the formation threshold
  peer: PeerSnapshot | null;
}
```

Keep this boundary clean. When the Cloud Anchors or UWB upgrade happens later,
it replaces the producer of these numbers and adds a `peerPosition` field —
nothing in the AR layer should need rewriting.

---

## 4. Signal processing spec

Implement exactly this in `src/signal/`. These constants were chosen to be
tuned on-device; expose them in the debug HUD.

### 4.1 RSSI smoothing

Raw RSSI swings 10+ dBm while standing still. Apply an exponential moving
average in the dBm domain:

```
smoothed = α · rssi + (1 − α) · smoothedPrev     // α = 0.2
```

Seed with the first sample rather than 0. (Averaging in dBm rather than linear
power is technically incorrect but is standard practice and entirely fine here.)

### 4.2 Distance estimate

```
d = 10 ^ ((txPower − smoothedRssi) / (10 · n))     // n = 2.2 indoors
```

`txPower` is the **peer's** calibrated 1m reference, read from their payload
(byte 8) — not a hardcoded constant. Different phone models differ by 8+ dBm and
this is the single biggest source of asymmetry between the two devices.

Treat `d` as a band (near / close / adjacent), never as a number to display
outside the debug HUD.

```
proximity = clamp((D_FAR − d) / (D_FAR − D_NEAR), 0, 1)
            // D_NEAR = 0.5 m, D_FAR = 5.0 m
```

### 4.3 Alignment

```
delta     = ((headingA − headingB + 540) mod 360) − 180   // signed, −180..180
error     = 180 − |delta|                                  // 0 when facing
alignment = clamp(1 − error / TOLERANCE, 0, 1)             // TOLERANCE = 45°
```

**Fallback:** if either device reports heading accuracy < 2 (see payload byte 7),
or heading is the `0xFFFF` sentinel, set `alignment = 1` and drive the effect on
proximity alone. A degraded effect beats a broken one, and a user with a
miscalibrated compass should still see something.

### 4.4 Bond strength, hysteresis, staleness

```
raw = proximity · alignment
```

Apply hysteresis so the bridge doesn't strobe at the threshold:

- form when `raw > 0.60` sustained for 400 ms
- break when `raw < 0.35` sustained for 400 ms
- between thresholds, hold current state

**Staleness:** if no scan result for the peer has arrived in 2000 ms, decay
`strength` to 0 over 800 ms rather than snapping. Remove the peer from state
after 5000 ms of silence.

---

## 5. Repo layout

```
android/app/src/main/java/com/aurabridge/ble/
  BleAdvertiserModule.kt        // see docs/BLE_ADVERTISER_MODULE.md
  BleAdvertiserPackage.kt
src/
  ble/
    advertiser.ts               // TS wrapper over the native module
    scanner.ts                  // ble-plx scan loop + manufacturer filter
    payload.ts                  // encode/decode, pure + unit tested
    useNearbyPeers.ts           // hook: scan results -> PeerSnapshot[]
  signal/
    rssi.ts                     // EMA + distance model
    alignment.ts                // heading math
    bond.ts                     // hysteresis, staleness, BondState
  ar/
    BridgeScene.tsx             // ViroARScene
    effects.ts                  // particle + material config
  debug/
    DebugHUD.tsx                // numbers overlay, toggleable
  state/
    store.ts
docs/
  PAYLOAD_SPEC.md
  BLE_ADVERTISER_MODULE.md
```

---

## 6. Android specifics that will bite

- **Permissions (API 31+):** `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`,
  `BLUETOOTH_CONNECT`, `CAMERA`. Add
  `android:usesPermissionFlags="neverForLocation"` to the `BLUETOOTH_SCAN`
  declaration or the system forces a location permission request as well. All
  of these are runtime permissions — request before any BLE call.
- **Not every device can advertise.** Check
  `BluetoothAdapter.isMultipleAdvertisementSupported()` at startup and surface
  a clear message. Discover this on day one, not day nine.
- **Scan start throttling:** Android blocks an app that calls `startScan()` more
  than 5 times in 30 seconds. Start the scan once and leave it running; never
  restart it in a retry loop without backoff.
- **31-byte advertisement budget.** `setIncludeDeviceName(true)` will silently
  blow it and advertising will fail with `DATA_TOO_LARGE`. Both name and TX
  power inclusion must be off.
- **`react-native-ble-plx` cannot filter by manufacturer data** — its scan filter
  takes service UUIDs only. Phase 1 scans unfiltered and discards non-matching
  results in JS. This is fine in the foreground. If scan noise becomes a
  problem, add a 16-bit service UUID to the advertisement (costs 4 bytes from
  the reserved block) and filter natively.
- **ARCore availability** is not universal. Check at startup and fail loudly.
- BLE APIs must not be called before `BluetoothAdapter.isEnabled()`.

---

## 7. Conventions

- TypeScript strict. No `any` in `src/signal/` or `src/ble/payload.ts`.
- `payload.ts` and everything in `src/signal/` must be **pure functions** with
  unit tests. These are the parts you cannot debug by looking at a phone.
- Byte handling: big-endian throughout, explicitly. Never rely on platform
  default endianness.
- The debug HUD is a first-class feature, not scaffolding. Keep it working
  through every phase; it is the only way to diagnose radio behaviour.
- Commit per task in `TASKS.md`, referencing the task ID.

---

## 8. Testing

Two physical Android devices are required. Nothing about this project can be
validated in an emulator — no BLE radio, no ARCore, no compass.

Before starting each session, confirm: Bluetooth on, both apps foregrounded,
screens on, permissions granted.

Unit-testable without hardware: payload encode/decode round-trips, RSSI
smoothing, distance model, alignment math, hysteresis state machine. Write these
tests; they will save more time than they cost.

---

## 9. Phase gate

Do not begin Phase 3 (AR) until Phase 2's acceptance criteria are met. The
temptation to start on the visual effect early is strong and it is a trap: if
the signal layer is unstable, the effect will flicker and you will waste days
debugging the wrong layer. See `TASKS.md`.
