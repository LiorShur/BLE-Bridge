# Bridge GATT Specification (interop path)

The connection-based protocol used for **cross-platform** bridging, per
`docs/IOS_INTEROP.md`. iOS cannot advertise our manufacturer-data payload, so a
mixed pair (or any pair using this path) discovers by **service UUID** and
exchanges the payload over a **GATT connection**. Android↔Android keeps the
connectionless manufacturer-data path unchanged (dual-stack, owner's choice).

This reverses two deliberate CLAUDE.md §3.1 decisions **for this path only**:
peers *do* connect, and advertising becomes *connectable*. Flagged in
IOS_INTEROP §1; this is the concrete design.

---

## 1. Identifiers

Fixed 128-bit UUIDs for the PoC (replace before any public release):

| Role | UUID |
|---|---|
| Bridge **service** | `A0E1B5D2-7C3F-4E8A-9B10-2F6C1D4E7A90` |
| **Payload** characteristic (read + notify) | `A0E1B5D2-7C3F-4E8A-9B10-2F6C1D4E7A91` |

One characteristic is enough: its value **is the existing 24-byte payload**
(`src/ble/payload.ts`), reactions and ack included (bytes 12–22). The codec, and
all its tests, are reused verbatim — the wire format does not change, only its
transport.

---

## 2. Advertisement strategy (the crux)

The problem: a device must stay discoverable by an iOS central (which can only
scan by service UUID) **and** by other Androids (which read manufacturer data),
without exceeding the 31-byte legacy advertisement budget. A 128-bit service UUID
(18 bytes) plus the 24-byte manufacturer payload does not fit in one 31-byte
packet.

**Solution — use the scan response as a second packet:**

| Packet | Contents | Consumed by |
|---|---|---|
| Primary AdvData (31 B) | Manufacturer data = the 24-byte payload | Android↔Android connectionless path (unchanged) |
| **Scan response** (31 B) | The 128-bit Bridge **service UUID** | GATT centrals (iOS + the Android GATT path) discover & may connect |

Active scanners (ble-plx and iOS CoreBluetooth both scan actively) receive the
scan response merged with the AdvData, so one advertiser serves both paths.

**Connectable:** the advertisement becomes `setConnectable(true)` (was `false`).
A connectable advertisement still carries manufacturer data that scanners read
*without* connecting, so Android↔Android behaviour is unchanged — connectable
only *permits* GATT, it does not force it.

---

## 3. Roles — who connects

Both devices advertise (peripheral / GATT server) **and** scan (central). To
avoid two redundant links per pair:

> **Lower `peerId` is the central** and initiates the connection; the higher-id
> device stays peripheral for that pair and does not dial back.

- **Android↔Android / Android↔iOS discovering an Android:** the Android reads the
  peer's `peerId` from the manufacturer data *before* connecting, so the
  tie-break is decided pre-connect.
- **Discovering an iOS peer** (no manufacturer data on the wire): `peerId` is
  unknown until the payload characteristic is read, so use post-connect dedup —
  either side may connect; once both `peerId`s are known, the device that should
  have been peripheral drops its outbound link. Idempotent and races-safe.

Multi-peer = N independent pairings, each tie-broken separately.

---

## 4. Connection lifecycle (central side)

1. Scan for the Bridge service UUID (ble-plx `startDeviceScan([SERVICE_UUID], …)`
   — native filtering, unlike the manufacturer path).
2. On a match this device should dial (§3): `connect` → `discoverAllServices` →
   locate the payload characteristic.
3. **Subscribe** to notifications on the payload characteristic. Each notify
   carries a fresh 24-byte payload; decode with the existing codec and feed the
   signal engine exactly like a scan observation.
4. **RSSI:** poll `device.readRSSI()` at ~3 Hz; feed the same `rssi.ts` EMA +
   distance model. (`txPower` comes from the peer's payload — a per-model
   constant on iOS, which does not expose advertised TX power.)
5. **Heading / hue / reactions:** all already in the payload characteristic value
   — nothing extra to exchange.

## 5. Peripheral (GATT server) side

- Host the Bridge service with the payload characteristic.
- Keep the characteristic value current (same republish policy as PAYLOAD_SPEC
  §7: on >5° heading change or every 1 s) and **notify** subscribers on change.
- Reactions/acks: writing the local user's reaction into the payload (bytes
  12–22) and notifying is the whole mechanism — no separate write characteristic
  needed for the PoC.

## 6. Staleness & disconnect

- A notify stream stopping is the connection-based analogue of scan silence: run
  the same staleness decay (`bond.ts`) keyed on last-notify time.
- On disconnect, decay `strength` to 0 and attempt one reconnect with backoff
  (never a tight loop — mirror the scan-throttle discipline). Remove the peer
  after the standard silence window.

## 7. What reuses vs. what's new

Reuses verbatim: `payload.ts` (as the characteristic value), all of `signal/`
(rssi, alignment, bond), the store, and the UI. New: a native GATT **server**
module (Kotlin, analogous to the advertiser), a GATT **central** client over
ble-plx, and the scan-response/connectable advertiser change. The
`BondState` boundary (§3.4) means the AR/UI layer needs no changes.

## 8. Phased delivery

- **P-i1 (now):** implement §4–§6 for **Android↔Android over GATT**, behind a
  `GATT_ENABLED` flag (default off), in parallel with the manufacturer path.
  Proven on the existing Android phones before any iOS work. The debug HUD gains
  a per-peer "transport: adv | gatt" line.
- **P-i2:** iOS app + Swift peripheral/central (CoreBluetooth) → iOS↔iOS.
- **P-i3:** Android↔iOS — mostly integration + per-iPhone `txPower` calibration.

Constants live in `src/ble/gatt/constants.ts`.
