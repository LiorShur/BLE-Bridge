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

12 bytes used, 12 reserved.

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
| 12 | 12 | `reserved` | — | Must be written as zero. Receivers must ignore. |

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
| 3 | `0x08` | Reserved |
| 4 | `0x10` | Reserved |
| 5 | `0x20` | Reserved |
| 6 | `0x40` | Reserved |
| 7 | `0x80` | Reserved |

Reserved bits must be transmitted as zero and ignored on receipt, so that a
version-1 receiver keeps working against a later sender that sets them.

For the PoC only bit 0 needs to be honoured; bits 1 and 2 are populated but
unused, and exist so the wire format doesn't need a version bump later.

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
