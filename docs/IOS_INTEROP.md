# Android ↔ iOS Interop — Architecture & Protocol Plan

Status: **proposed** (owner approved the interop target 2026-08-10; Apple
Developer account + Mac available). No native iOS code written yet — this doc is
the design that must be agreed before it is, because it **reverses a deliberate
architectural decision** (CLAUDE.md §3.1). Read §1 first.

---

## 1. The forcing constraint (why §3.1 must change for interop)

CLAUDE.md §3.1 chose **connectionless BLE**: every phone advertises its full
~24-byte payload (peerId, heading, txPower, hue, reactions) and reads peers'
payloads straight out of scan results. On Android-only this is correct and it
works well on four handsets today.

**iOS cannot participate in that scheme.** Core Bluetooth's `startAdvertising`
accepts only two keys from an app:

- `CBAdvertisementDataLocalNameKey` (a string, foreground only), and
- `CBAdvertisementDataServiceUUIDsKey` (service UUIDs).

It **silently ignores manufacturer data and service data.** There is no API to
put our payload bytes into an iOS advertisement. In the background it's stricter
still: the local name is dropped and service UUIDs move to a special "overflow"
area that **only other iOS devices** can see — Android can't read it at all.

So the only thing an iOS device can reliably *broadcast* that an Android device
can *see* is: **the presence of a known service UUID, plus the RSSI of that
advertisement.** That's enough for discovery + proximity, but it carries **none**
of our real payload (heading, txPower, hue, reactions).

**Conclusion:** to exchange the payload across platforms, devices must **connect
(GATT)**. This reintroduces exactly the connection state §3.1 avoided
(central/peripheral roles, connect/disconnect races, MTU). It is not optional —
it is what iOS interop costs. This document is the "flag it first" §3.1 requires.

---

## 2. Chosen model: dual-role GATT with UUID discovery

Every device runs **both** BLE roles at once:

- **Peripheral (GATT server):** advertises a fixed 128-bit **Bridge Service
  UUID** and hosts the Bridge service (§4). This is how it is *found* and how its
  payload is *read*.
- **Central (GATT client):** scans for that same service UUID, connects to peers
  it finds, subscribes to their characteristics, and reads RSSI.

Discovery is by **service UUID only** (works Android↔iOS, foreground). Payload
travels over the **GATT connection**, not the advertisement.

### 2.1 Who connects to whom (role tie-break)

Both sides advertise and both scan, so without a rule two phones would each dial
the other and open two redundant links. Deterministic tie-break:

> The device with the **numerically lower `peerId` becomes Central** and
> initiates the connection; the higher-id device stays Peripheral-only for that
> pair and does not dial back.

`peerId` is exchanged in the first characteristic read (or embedded in the local
name during discovery — see §4.3). This keeps exactly one connection per pair.
Multi-peer (owner scope change) = N such pairings, each independently role-negotiated.

### 2.2 Keeping the Android-only fast path (optional, recommended)

Android↔Android already works connectionlessly and it's lower-latency and
battery-cheaper than GATT. Recommended posture:

- **Android advertises *both***: the existing manufacturer-data payload **and**
  the Bridge Service UUID. Two Androids keep using the connectionless path
  (unchanged); an iOS central discovers the Android by its service UUID and
  connects.
- **iOS is GATT-only** (it has no other option).

This dual-stack costs more Android code but preserves today's behaviour and
battery profile for the common case. If we'd rather not maintain two paths, the
alternative is "GATT for everyone", which is simpler conceptually but a bigger,
riskier change to the proven Android path. **Recommendation: dual-stack**, so the
working Android demo is never regressed by the iOS work.

---

## 3. What carries over vs. what is new

This is a React Native app, so the reuse is large — only the radio/sensor bridge
is platform-specific.

| Layer | Reuse on iOS? | Notes |
|---|---|---|
| `src/ble/payload.ts` (codec) | ✅ as-is | Same bytes become the GATT characteristic value. Pure + tested. |
| `src/signal/*` (rssi, alignment, bond) | ✅ as-is | Pure math. iOS feeds it RSSI + heading exactly like Android. |
| `src/reactions.ts`, `src/state/store.ts` | ✅ as-is | |
| `src/ui/*`, `src/ar/CameraBridge` | ✅ as-is | RN Views + vision-camera (has an iOS impl). |
| Native **advertiser** (Kotlin) | ❌ rewrite | → Swift `CBPeripheralManager` (GATT server + UUID advertise). |
| Native **scanner** (ble-plx) | ⚠️ mostly | ble-plx supports iOS central + connect; scan-by-UUID + connect + notify replaces manuf-data parsing. |
| Native **heading** (Kotlin) | ❌ rewrite | → Swift `CLLocationManager.heading` / CoreMotion. |
| Native **sound** (Kotlin ToneGenerator) | ❌ rewrite | → Swift `AudioToolbox`/`AVAudioPlayer`, or a bundled tone. |
| Delivery pipeline (GitHub Actions → APK) | ❌ new | macOS runner → signed IPA → TestFlight (§6). |

The design boundary at `BondState` (§3.4) pays off here: the AR/UI layer needs
**zero** changes — only the *producer* of proximity/alignment/peer changes.

---

## 4. Bridge GATT service (draft spec)

A companion `docs/GATT_SPEC.md` will pin this precisely; sketch here.

- **Service UUID:** one fixed 128-bit UUID (generate once; PoC value, replace for
  release). Both platforms advertise it; centrals scan/filter on it.
- **Payload characteristic** (read + notify): value is the **existing 24-byte
  payload** from `payload.ts` — unchanged wire format, so the codec and all tests
  are reused verbatim. Peripheral sends a `notify` whenever it republishes
  (heading moved >5° or 1 s elapsed — same policy as §7 of PAYLOAD_SPEC).
- **Reaction characteristic** (write-without-response, or fold into the payload
  notify): carries the reaction + ack block (bytes 12–22) so reactions/soft-ack
  work identically across the link.
- **peerId** is inside the payload, so identity still lives in the payload, not
  the MAC — §3.3 holds unchanged.

### 4.1 Proximity across platforms

RSSI is available to the central on both OSes (`readRSSI` on the connected
peripheral, polled ~2–4 Hz). Feed it into the **same** `rssi.ts` EMA + distance
model. `txPower` is read from the peer's payload characteristic (Android supplies
its calibrated value; iOS supplies a per-model constant in `docs/CALIBRATION.md`
since iOS doesn't expose advertise TX power).

### 4.2 Heading across platforms

iOS heading comes from `CLLocationManager` (true/magnetic heading + accuracy),
mapped onto our 0–3599 decidegree + 0–3 accuracy scheme so `alignment.ts` is
unchanged, including the low-accuracy `0xFFFF` fallback.

### 4.3 Discovery-time identity

To role-negotiate (§2.1) before connecting, the lower/higher-id comparison needs
each side's `peerId` early. Options: (a) put a short id in the iOS
`CBAdvertisementDataLocalNameKey` and an Android scan-record field; or (b) always
let *either* connect and drop the duplicate link after the first payload read
reveals both ids. (b) is simpler and avoids relying on the fragile local-name
channel — **recommended**.

---

## 5. Known iOS pitfalls to design around

- **Background is severely limited** — but CLAUDE.md non-goals already scope this
  to **foreground only**, so we stay in the supported path. State-preservation
  APIs are out of scope.
- **No manufacturer data** (the whole reason for this doc). Do not attempt it.
- **Connection latency**: GATT connect + service discovery adds ~1–3 s before the
  first payload arrives, vs. instant on Android's connectionless path. The
  "looking for someone…" state covers this; tune staleness so a brief GATT
  reconnect doesn't collapse the bridge.
- **iOS simulator has no BLE** — like Android, iOS testing is on real devices only.
- **Permissions**: `NSBluetoothAlwaysUsageDescription`, `NSCameraUsageDescription`,
  and a location string (heading uses `CLLocationManager`) in `Info.plist`.

---

## 6. Build, signing & delivery (macOS)

Mirrors the Android CI philosophy (repo has no committed RN shell; CI generates
it), on a macOS runner:

1. **`macos-latest` GitHub Actions runner** generates the RN 0.74.5 iOS project,
   overlays `src/` + the Swift native modules + `Info.plist`, `pod install`.
2. **Signing**: import the Apple Developer certificate + provisioning profile
   from GitHub secrets (never committed). Team id / bundle id configured.
3. **Distribution**: `xcodebuild -exportArchive` → **TestFlight** upload (there is
   no "sideload an IPA" path for normal users like Android's APK). Testers install
   via the TestFlight app from an invite. Ad-hoc (UDID-registered) `.ipa` is an
   option for a tiny known device set and avoids App Store Connect review latency.
4. Artifact: the `.ipa` for record; the real hand-off is the TestFlight build.

macOS runner minutes cost more than Linux; the iOS build is heavier than the APK.

---

## 7. Phasing (proposed)

Each phase is independently demonstrable, smallest-risk first:

- **P-i0 — GATT spec pinned.** Write `docs/GATT_SPEC.md` (UUIDs, characteristics,
  notify policy, role tie-break). No code. *Gate: owner sign-off on the reversal.*
- **P-i1 — Android GATT server + central, Android↔Android over GATT.** Prove the
  connection-based path on hardware we already have, *before* touching iOS. Keeps
  the manuf-data path in parallel (dual-stack). De-risks the whole model on known
  devices.
- **P-i2 — iOS app shell + native modules (Swift peripheral/central/heading/
  sound), iOS↔iOS bridge.** Proves the iOS radio path. Needs the macOS CI + signing
  from §6 stood up first.
- **P-i3 — Android↔iOS interop.** The target. Mostly integration + tuning
  (txPower calibration per iPhone model, connection-latency staleness, role
  tie-break across OSes).
- **P-i4 — polish**: reactions/soft-ack over GATT, multi-peer across mixed OSes.

The pure core (`payload`, `signal`, `reactions`, store, UI) is untouched
throughout — every phase reuses it.

---

## 8. Open decisions for the owner

1. **Dual-stack vs. GATT-everywhere** (§2.2). Recommend dual-stack to protect the
   working Android demo.
2. **TestFlight vs. ad-hoc** distribution (§6.3). Recommend ad-hoc for the small
   known device set (faster, no review); TestFlight if the tester list grows.
3. **Bundle id / team** — needed to wire signing; supplied from the Apple account.

Nothing in §1's constraint is negotiable; everything in §8 is.
