# GATT messaging channel (Tier 2)

Upgrade the connectionless beacon into a real device-to-device **data pipe** for
messages and small structured data — chat, contact/profile exchange, small
thumbnails — **cross-platform, no pairing, offline**, reusing the GATT stack the
iOS interop path already established.

This is the "tier 2" from the transport analysis: BLE advertising = discovery
beacon (who's here); a **GATT connection** = the pipe you upgrade to when you want
to exchange more than 24 bytes. Realistic ceiling: text/JSON instantly, small
images (single-digit KB) in 1–4 s; NOT full photos/video (use a fat pipe or a
backend relay for those — out of scope here).

Status: **M0–M3 code-complete; on-device validation pending.** The pure layers
(frame codec, reassembler, outbound queue, envelope, UTF-8) are unit-tested; the
native characteristic, wrappers, central primitives, the `GattMessaging`
orchestration service, and a chat UI are all in. What remains is **tuning on two
devices** — transport-choice edge cases, MTU behaviour, retransmit timing — which
can only be observed on real radios (like the interop itself took several rounds).

---

## 1. Where it plugs in

The Bridge GATT service already exists (`docs/GATT_SPEC.md`), with one
characteristic:

- `PAYLOAD_CHAR_UUID …7a91` — read + notify, value = the 24-byte advertisement
  payload. Untouched by this feature.

Messaging adds **one more characteristic on the same service**:

- `MESSAGE_CHAR_UUID …7a92` — **write** (central→peripheral) + **notify**
  (peripheral→central). One characteristic, bidirectional: the central writes
  frames to it; the peripheral pushes frames back as notifications. No new
  service, no new connection — it rides the connection the interop path already
  opens.

**MTU.** Right after connecting, request the largest ATT MTU the peer allows (up
to 517). Usable per-frame bytes = `negotiatedMtu − 3` (ATT opcode + handle). We
frame our own protocol inside that and never assume a specific MTU — the chunker
takes the live value.

This does extend CLAUDE.md §3.1 ("peers never connect"), but the interop path
already crossed that line; messaging reuses the same connection rather than
adding another. Flag it there when built.

---

## 2. The framing protocol (M1 — pure, `src/ble/gatt/messaging.ts`)

A **message** (a chat string, a profile blob) is chunked into **frames** that each
fit one MTU write/notify. The receiver reassembles by message id and acks.

### 2.1 Frame layout (big-endian, 10-byte header)

| Offset | Size | Field | Notes |
|---:|---:|---|---|
| 0 | 1 | `version` | `0x01`. Reject unknown. |
| 1 | 1 | `type` | `1`=TEXT, `2`=PROFILE, `3`=ACK. |
| 2 | 2 | `msgId` | uint16, identifies the message; wraps. |
| 4 | 2 | `seq` | uint16, 0-based chunk index. |
| 6 | 2 | `count` | uint16, total chunks in this message. |
| 8 | 2 | `payloadLen` | uint16, payload bytes in THIS frame. |
| 10 | … | `payload` | `payloadLen` bytes. |

An **ACK** frame is header-only: `type=ACK`, `msgId=<completed id>`,
`seq=0 count=0 payloadLen=0`. Sent once a message is fully received.

### 2.2 Pure API

```ts
frameMessage(type, msgId, bytes, maxFrameBytes): Uint8Array[]   // chunk → frames
encodeFrame(frame): Uint8Array
decodeFrame(bytes): Frame | null                                // validates; null on bad
ackFrame(msgId): Uint8Array

class Reassembler {                        // one per peer connection
  ingest(bytes): { message?: {type,msgId,bytes}, ack?: number } | null
  sweep(now): void                         // drop partials older than a TTL
}
```

- **Chunking:** `chunkPayload = maxFrameBytes − 10`. A 0-length message still
  produces one frame (`count=1, seq=0, payloadLen=0`).
- **Reassembly:** collect frames by `msgId`, dedupe by `seq`, tolerate
  out-of-order; when all `count` chunks are present, concatenate in `seq` order,
  emit `{message}` **and** `{ack: msgId}`. An incoming ACK frame emits `{ack}` with
  no message.
- **Bounded state:** cap in-flight messages and drop the oldest / stale (TTL via
  `sweep`) so a dropped final chunk can't leak memory. Never throws on malformed
  input — returns `null`, exactly like the payload codec.

This layer is transport-agnostic and fully unit-tested off-device (round-trips,
out-of-order, duplicates, truncation, MTU boundaries, oversized reassembly guard).

### 2.3 Reliability

Best-effort with app-level acks (the connection itself is reliable/ordered per
GATT, but writes can fail and notifies can be missed under load):

- Sender keeps a message "unacked" until it sees the ACK; retransmit all frames
  after a timeout, up to N tries, then surface a failed-send.
- Receiver acks on completion; a duplicate completed message (same msgId re-sent
  because our ACK was lost) is de-duped and simply re-acked.

---

## 3. Message types

- **TEXT** — UTF-8 string. The chat MVP.
- **PROFILE** — a compact profile blob so **name + interests + headline (and,
  budget permitting, a tiny thumbnail) transfer peer-to-peer with NO backend.**
  This is the strategically interesting one: it deepens the serverless property —
  today profiles need Firebase; over GATT they don't. v0 encoding: UTF-8 JSON
  `{name, interests[], headline}` (thumbnail deferred — even a small one is 10–40
  KB and wants compression + a size cap). The pure layer just moves bytes; the
  profile encode/decode is a thin wrapper.
- **ACK** — receipt (header-only).

Types are a small enum so unknown types are ignored forward-compatibly.

---

## 4. Native wiring (M2 — not built)

- **Kotlin GATT server** (`BleGattServerModule`): add `MESSAGE_CHAR_UUID` with
  WRITE + NOTIFY, a CCC descriptor, `onCharacteristicWriteRequest` → hand bytes to
  JS, and a `notifyMessage(base64)` method → `notifyCharacteristicChanged`.
  Request a larger MTU on connect (`onMtuChanged` surfaces the value).
- **Swift `BlePeripheral`**: add the characteristic with `.write` + `.notify`,
  handle `didReceiveWrite`, and `updateValue` for outbound frames.
- **`gattClient.ts` (central)**: after connect, negotiate MTU, subscribe to the
  message characteristic (inbound notifies), and `writeCharacteristicWithResponse`
  for outbound frames. Feed both directions through one `Reassembler` per peer.
- **A small `GattMessaging` service** owns the per-peer Reassembler + the unacked
  send queue + retransmit timers, exposing `send(peerId, type, bytes)` and an
  `onMessage` callback. Decoupled from the signal engine.

## 5. UI (M3 — not built)

- A minimal chat surface reachable from a bonded peer's card / the Nearby sheet.
- "Share profile" action that sends a PROFILE message; received profiles populate
  the same `profiles` store cache the Firebase path uses (so the beam/cards show
  them), tagged as peer-supplied.

---

## 6. Phasing

- **M0 — spec.** ✅ this document.
- **M1 — pure protocol.** ✅ `src/ble/gatt/messaging.ts` — frame codec, chunker,
  Reassembler, acks; fully unit-tested off-device. No transport, no UI.
- **M2 — native characteristic + client wiring.**
  - ✅ Kotlin `BleGattServerModule`: MESSAGE char (write+notify), inbound-write →
    `BleGattServer:message` event, `onMtuChanged` → `BleGattServer:mtu`, per-char
    CCCD routing, `notifyMessage`.
  - ✅ Swift `BlePeripheral` (now an `RCTEventEmitter`): MESSAGE char, `didReceiveWrite`
    → `BlePeripheral:message`, notify-size on subscribe → `BlePeripheral:mtu`,
    `notifyMessage`.
  - ✅ TS wrappers (`gattServer.ts`, `iosPeripheral.ts`): `notifyMessage` + the
    message/mtu event subscriptions.
  - ✅ `gattClient.ts` central: `requestMTU(517)`, subscribe to the message
    characteristic (`setMessageSink`), `writeMessageFrame`, `peerMtu`.
  - ✅ `outbound.ts`: pure ack/retransmit `OutboundQueue`, unit-tested.
  - ✅ **`GattMessaging` service** (`gattMessaging.ts`): per-channel `Reassembler`,
    a global `OutboundQueue`, msgId allocation, a 4-byte sender-peerId **envelope**
    (`messaging.ts`) so inbound frames identify their sender regardless of
    transport, transport choice (central `writeMessageFrame` if we dialed the peer,
    else peripheral `notifyMessage` broadcast), a retransmit tick, and ack/re-ack.
    `gattClient` learns peerId↔deviceId (`deviceIdForPeer`) for routing.
  - ✅ `utf8.ts`: a pure UTF-8 codec (Hermes lacks a reliable TextEncoder),
    unit-tested against the platform encoder.
- **M3 — chat UI.** ✅ `features/chat/ChatSheet.tsx` — per-peer history + composer,
  opened from a bonded peer's card; `store.sendChat` shows the line optimistically
  and hands it to the transport; inbound text lands via `useBondEngine`. Serverless
  **profile-over-GATT** (PROFILE type into the `profiles` cache) is scaffolded by
  the protocol but not yet wired to the UI — a small follow-up.

### Known limitation
Messaging needs a GATT connection, so it works **iPhone↔Android** and
**iPhone↔iPhone**, NOT **Android↔Android** (connectionless by design — CLAUDE.md
§3.1). The chat UI says so. Android↔Android chat would require re-enabling an
Android↔Android GATT link (removed in the interop-always-on refactor).

M1 is the whole hard, testable core — the part you cannot debug by looking at a
phone — and lands first, exactly like `payload.ts` and the discovery brain did.
```
