# Advertisement Payload Specification

Version 1. All multi-byte fields are **big-endian** (network byte order).

---

## 1. Advertisement budget

A legacy BLE advertisement carries 31 bytes of AdvData total. The budget:

| Consumer | Bytes | Note |
|---|---:|---|
| Flags AD structure | 3 | Added by the Android stack |
| Manufacturer Specific Data header | 2 | Length byte + AD type `0xFF` |
| Company identifier | 2 | `0xFFFF` |
| **Available payload** | **24** | |

`0xFFFF` is the Bluetooth SIG identifier reserved for testing and development —
correct for a proof of concept, and it must be replaced before any public
release.

**Both `setIncludeDeviceName` and `setIncludeTxPowerLevel` must be `false`.**
Enabling the device name alone will overflow 31 bytes and advertising will fail
with `ADVERTISE_FAILED_DATA_TOO_LARGE` (error code 1).

---

## 2. Layout

24 bytes used, 0 reserved.

| Offset | Size | Field | Type | Description |
|---:|---:|---|---|---|
| 0 | 1 | `version` | uint8 | Protocol version. Currently `0x01`. Reject any packet whose version is not recognised. |
| 1 | 4 | `peerId` | uint32 BE | Random session identity. **The only valid peer identity** — see §4. |
| 5 | 2 | `heading` | uint16 BE | Compass heading in decidegrees, `0`–`3599` (0.1° resolution). `0xFFFF` = unavailable. |
| 7 | 1 | `headingAccuracy` | uint8 | `0` unreliable, `1` low, `2` medium, `3` high. Mirrors Android's `SensorManager.SENSOR_STATUS_ACCURACY_*`. |
| 8 | 1 | `txPower` | **int8** | Calibrated RSSI at 1 m, in dBm. Typically around `-59` (i.e. `0xC5`). See §3. |
| 9 | 1 | `hue` | uint8 | Aura colour seed. Map to `0`–`360°` as `hue × 360 / 255`. |
| 10 | 1 | `flags` | uint8 | Bitfield, see §5. |
| 11 | 1 | `sequence` | uint8 | Increments on each republish, wraps at 255. Lets the receiver measure refresh rate and detect a stalled advertiser. |
| 12 | 4 | `reactionTarget` | uint32 BE | peerId this reaction is addressed to; `0` = none. See §9. |
| 16 | 1 | `reactionId` | uint8 | Which reaction (`0` = none). Catalog in `src/reactions.ts`. |
| 17 | 1 | `reactionNonce` | uint8 | Increments per fresh send so a receiver fires exactly once. |
| 18 | 4 | `ackTarget` | uint32 BE | peerId whose reaction this confirms; `0` = none. See §9. |
| 22 | 1 | `ackNonce` | uint8 | Echoes the `reactionNonce` being confirmed. |
| 23 | 1 | `interestBucket` | uint8 | Discovery hint (`docs/DISCOVERY_SPEC.md`): coarse primary-interest category, `0` = unset. See §10. |

> **Reactions (bytes 12–17), the delivery ack (bytes 18–22), and the discovery
> `interestBucket` (byte 23) were all added in the previously-reserved block
> without a version bump.** Because §6 requires receivers to ignore reserved bytes
> and tolerate short/long buffers, a build that predates any of these simply reads
> it as 0 and ignores it — the forward-compatibility the reserved block was for.
> The reserved block is now fully consumed; the next added field needs a version
> bump or a different carrier (e.g. the backend profile — see §10).

### Reference encoding

```
01 A3F91C4E 0E10 03 C5 7B 01 2A 000000000000000000000000
│  │        │    │  │  │  │  │  └─ reserved (12 bytes)
│  │        │    │  │  │  │  └──── sequence = 42
│  │        │    │  │  │  └─────── flags = 0b00000001 (available)
│  │        │    │  │  └────────── hue = 123 → ~174° (cyan)
│  │        │    │  └───────────── txPower = -59 dBm
│  │        │    └──────────────── headingAccuracy = 3 (high)
│  │        └───────────────────── heading = 3600? No: 0x0E10 = 3600 → INVALID
│  └────────────────────────────── peerId = 0xA3F91C4E
└───────────────────────────────── version = 1
```

Note the deliberate error above: `0x0E10` is 3600, which is out of range
(valid maximum is 3599, i.e. `0x0E0F`). A decoder must reject or clamp
out-of-range headings rather than trusting them. Use this case as a unit test.

---

## 3. `txPower` — why it is transmitted

The distance model needs a reference RSSI measured at 1 m. That reference is a
property of the **transmitting** radio, and it varies by more than 8 dBm between
phone models. If both devices assume the same hardcoded constant, they will
compute different distances for the same physical separation, and the bridge
will form on one screen before the other.

Each device therefore advertises its own calibrated value, and the receiver uses
the **peer's** advertised `txPower` in the path-loss calculation — never a local
constant.

Calibration procedure (task P2-2): place the two devices exactly 1 m apart in an
open space, record RSSI for 30 seconds, take the mean, round to the nearest
integer dBm. Store per model in `docs/CALIBRATION.md`.

Encoded as a **signed** 8-bit integer. `-59` is `0xC5`, not `0x3B`. This is a
common decoding bug — cover it with a test.

---

## 4. `peerId` — why the MAC address cannot be used

Android randomises the advertiser's Bluetooth address at intervals (roughly
every 15 minutes) and there is no supported way to disable it. A receiver keying
peers on `device.id` from a scan result will see the peer disappear and be
replaced by an apparent stranger mid-session, with no error.

`peerId` is generated once as a random uint32 and held for the app session.
Collision probability across two devices is negligible.

**Rule:** the scan result's device address may be used for nothing except
possibly de-duplicating rapid callbacks within a single second. Identity,
state keying, and UI all use `peerId`.

---

## 5. `flags` bitfield

| Bit | Mask | Meaning |
|---:|---|---|
| 0 | `0x01` | Available — user is open to forming a bridge |
| 1 | `0x02` | Already bridged to another peer |
| 2 | `0x04` | Device is stationary (from accelerometer) |
| 3 | `0x08` | Looking to meet — user is in discovery mode, open to meeting nearby strangers (`docs/DISCOVERY_SPEC.md`). Distinct from bit 0. |
| 4 | `0x10` | Reserved |
| 5 | `0x20` | Reserved |
| 6 | `0x40` | Reserved |
| 7 | `0x80` | Reserved |

Reserved bits must be transmitted as zero and ignored on receipt, so that a
version-1 receiver keeps working against a later sender that sets them.

For the PoC bit 0 gates bridging; bits 1 and 2 are populated but unused; bit 3
(`LOOKING_TO_MEET`) gates the discovery feature (§10). Bits 4–7 remain reserved.

---

## 6. Decoder requirements

A decoder must reject a packet — silently, returning `null` — when any of the
following hold. Every one of these is a unit test in task P1-2.

1. Buffer shorter than 12 bytes.
2. `version` is not `0x01`.
3. `heading` is outside `0`–`3599` and is not the `0xFFFF` sentinel.
4. `headingAccuracy` is greater than `3`.
5. `peerId` is `0x00000000` (reserved as "unset").

A decoder must **not** reject on: buffer longer than 24 bytes, non-zero reserved
bytes, or unknown flag bits. Tolerating these is what makes forward
compatibility possible.

---

## 7. Republish policy

Changing the advertised payload on Android requires stopping and restarting the
advertiser — there is no in-place update API. Republishing at sensor rate will
churn the radio and can trip platform rate limits.

Republish only when **either** condition is met:

- heading has changed by more than 5°, **or**
- 1000 ms have elapsed since the last republish

Increment `sequence` on every republish. A receiver seeing `sequence` unchanged
across many packets is looking at a stalled advertiser, which is useful
diagnostic information for the debug HUD.

---

## 8. Optional: adding a service UUID

`react-native-ble-plx` filters scans by service UUID only; it cannot filter on
manufacturer data. Phase 1 therefore scans unfiltered and discards non-matching
results in JavaScript, which is acceptable in the foreground.

If scan noise becomes a problem, add a 16-bit service UUID AD structure. This
costs 4 bytes (1 length + 1 type + 2 UUID), reducing the reserved block from 12
bytes to 8. The field layout in §2 is unchanged. Pick an unallocated 16-bit
value for the PoC and move to a proper 128-bit UUID before any release — noting
that a 128-bit UUID costs 18 bytes and will not fit alongside this payload in a
single legacy advertisement.

---

## 9. Reactions (bytes 12–17)

A bonded pair can exchange small predefined "reactions" (❤️ 👋 ✨ …) over the same
one-way broadcast — no GATT connection.

- The sender writes `reactionTarget` = the recipient's `peerId`, `reactionId` =
  the catalog id (`src/reactions.ts`), and bumps `reactionNonce`. It broadcasts
  this for ~2 s, then reverts `reactionId` to 0.
- A receiver acts only when `reactionId != 0` **and** `reactionTarget` equals its
  own `peerId`, and only when `(senderPeerId, reactionNonce)` is one it hasn't
  seen — so a reaction repeated across many packets fires exactly once.

### Delivery ack (bytes 18–22)

A soft-ack rides the same broadcast so a sender can show a "delivered" cue. When
a receiver acts on a reaction it broadcasts, for ~2 s, `ackTarget` = the original
sender's `peerId` and `ackNonce` = the `reactionNonce` it just consumed. The
original sender plays its "delivered" tone when it sees an ack addressed to it
whose `ackNonce` matches a reaction it recently sent (deduped per
`(peerId, ackNonce)`).

This is still best-effort: the ack is itself an unacknowledged broadcast, so a
missed ack simply means no "delivered" cue — never a lost reaction. It only ever
*adds* a confirmation; it never gates delivery.

**Properties and limits (inherent to the connectionless design, CLAUDE.md §3.1):**
best-effort (the soft-ack above is the only receipt signal); broadcast, not
private (addressed by `peerId`, but anyone in range can observe it); and tiny (a
fixed catalog, not arbitrary data). Rich or reliable messaging would require a
GATT channel — a deliberate non-goal here.

---

## 10. Discovery hint (byte 23)

Supports the "someone nearby you should meet" feature (`docs/DISCOVERY_SPEC.md`),
paired with the `LOOKING_TO_MEET` flag (bit 3, §5).

- `interestBucket` is the sender's **primary** interest's coarse category id
  (`1`–`255`; `0` = unset). It is a *hint*, not a match: a scanner uses it to
  cheaply decide whether to fetch that peer's full profile before ranking. The
  real interest match is computed from the peer's `interests[]` list, which lives
  in the **backend profile** (like name/photo), never on the wire — the payload is
  full and interests don't fit.
- Because it occupies the last formerly-reserved byte, a build predating it reads
  byte 23 as 0 (unset) and the feature simply doesn't engage. No version bump.
- Anyone in range can observe the bucket; it is deliberately coarse (a category,
  not a tag list) so nothing sensitive rides the broadcast. See
  `docs/DISCOVERY_SPEC.md §6` for the privacy model.
