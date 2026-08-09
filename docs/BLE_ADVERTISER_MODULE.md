# Kotlin Native Module Spec — `BleAdvertiser`

A React Native native module wrapping Android's `BluetoothLeAdvertiser`. Roughly
150 lines. This spec is the contract; implement to it rather than improvising.

**Package:** `com.aurabridge.ble`
**Files:** `BleAdvertiserModule.kt`, `BleAdvertiserPackage.kt`
**JS access:** `NativeModules.BleAdvertiser`, wrapped by `src/ble/advertiser.ts`

---

## 1. Why this is written rather than installed

The RN ecosystem's BLE peripheral libraries are patchily maintained and abstract
away exactly the controls this project needs: raw payload bytes, advertise mode,
TX power level, and the connectable flag. The surface area required here is
small and the failure modes are ones you want to see directly.

---

## 2. Public API

All methods return promises. All reject with a mapped error code (§5) rather
than a raw exception.

### `isSupported(): Promise<SupportReport>`

```ts
interface SupportReport {
  supported: boolean;
  bluetoothPresent: boolean;
  bluetoothEnabled: boolean;
  advertisingSupported: boolean;   // isMultipleAdvertisementSupported()
  reason?: string;                 // human-readable, only when supported=false
}
```

Never throws. Called on the startup capability screen (task P0-6). Note that
`isMultipleAdvertisementSupported()` returns `false` on a real minority of
Android devices — surfacing this clearly on day one is the whole point of the
method.

### `startAdvertising(payloadBase64: string): Promise<void>`

Decodes base64 to a byte array and begins advertising. Rejects if already
advertising (use `updatePayload` instead), if the payload exceeds 24 bytes, or
on any `AdvertiseCallback` failure.

Resolves only after `onStartSuccess` fires — not optimistically on the call
returning. The Android API is asynchronous and an optimistic resolve will make
Phase 1 debugging significantly harder.

### `updatePayload(payloadBase64: string): Promise<void>`

Android has no in-place payload update. Implement as stop → start internally,
holding the same settings. If not currently advertising, behave as
`startAdvertising`.

**Debounce internally at 500 ms minimum** as a safety net; the JS layer also
enforces the republish policy in `PAYLOAD_SPEC.md` §7, but the native layer
should not trust it.

### `stopAdvertising(): Promise<void>`

Idempotent — resolves cleanly if not currently advertising.

### `getStatus(): Promise<{ advertising: boolean; lastError: string | null }>`

---

## 3. Advertise configuration

```kotlin
val settings = AdvertiseSettings.Builder()
    .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
    .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
    .setConnectable(false)
    .setTimeout(0)
    .build()

val data = AdvertiseData.Builder()
    .setIncludeDeviceName(false)      // MUST be false — see PAYLOAD_SPEC §1
    .setIncludeTxPowerLevel(false)    // MUST be false
    .addManufacturerData(0xFFFF, payloadBytes)
    .build()

advertiser.startAdvertising(settings, data, advertiseCallback)
```

Rationale for each:

- **`ADVERTISE_MODE_LOW_LATENCY`** — roughly 100 ms advertising interval. Power
  hungry, and correct: this is a foreground-only demo where discovery latency is
  the thing users judge.
- **`ADVERTISE_TX_POWER_HIGH`** — maximises range and, more importantly, makes
  RSSI readings more stable at the 1–5 m distances that matter here.
- **`setConnectable(false)`** — deliberate. The architecture is connectionless
  (`CLAUDE.md` §3.1). Non-connectable advertisements also carry slightly less
  header overhead and cannot be interfered with by stray central devices trying
  to connect.
- **`setTimeout(0)`** — advertise indefinitely. Any non-zero value caps at
  180000 ms and will silently stop the advertiser mid-demo.

---

## 4. Events

Emitted via `DeviceEventManagerModule.RCTDeviceEventEmitter`. All emission must
be marshalled to the main thread — `AdvertiseCallback` fires on a binder thread.

| Event | Payload | When |
|---|---|---|
| `BleAdvertiser:started` | `{}` | `onStartSuccess` |
| `BleAdvertiser:failed` | `{ code: string, message: string }` | `onStartFailure` |
| `BleAdvertiser:stopped` | `{ reason: 'user' \| 'lifecycle' }` | After a successful stop |

---

## 5. Error code mapping

Map Android's integer failure codes to stable string codes. Never surface the
raw integer to JavaScript.

| Android constant | Int | Emitted code | Meaning / likely cause |
|---|---:|---|---|
| `ADVERTISE_FAILED_DATA_TOO_LARGE` | 1 | `DATA_TOO_LARGE` | Payload over budget — check device name inclusion is off |
| `ADVERTISE_FAILED_TOO_MANY_ADVERTISERS` | 2 | `TOO_MANY_ADVERTISERS` | Another app is advertising; usually transient |
| `ADVERTISE_FAILED_ALREADY_STARTED` | 3 | `ALREADY_STARTED` | Internal state desync — a bug in this module |
| `ADVERTISE_FAILED_INTERNAL_ERROR` | 4 | `INTERNAL_ERROR` | Stack error; toggling Bluetooth usually clears it |
| `ADVERTISE_FAILED_FEATURE_UNSUPPORTED` | 5 | `FEATURE_UNSUPPORTED` | Device cannot advertise at all |

Additional module-level codes:

| Code | When |
|---|---|
| `BLUETOOTH_UNAVAILABLE` | `BluetoothAdapter` is null |
| `BLUETOOTH_DISABLED` | Adapter present but not enabled |
| `PERMISSION_DENIED` | `BLUETOOTH_ADVERTISE` not granted (API 31+) |
| `PAYLOAD_TOO_LARGE` | Caller passed more than 24 bytes — caught before the platform call |
| `INVALID_BASE64` | Payload string failed to decode |

---

## 6. Lifecycle

Implement `LifecycleEventListener`:

- **`onHostPause`** — stop advertising, emit `stopped` with `reason: 'lifecycle'`,
  remember that it was active.
- **`onHostResume`** — if it was active on pause, restart with the last payload.
- **`onHostDestroy`** — stop advertising and release the callback reference.

A leaked advertiser survives app restarts within a Bluetooth session and will
produce the confusing symptom of two peers appearing when only one device is
running. Get the teardown right early.

---

## 7. Implementation notes

**Hold a single `AdvertiseCallback` instance** as a module field. Android
requires the *same* object reference to stop an advertisement that it was
started with; constructing a new callback per call means `stopAdvertising` will
silently do nothing.

**Guard all state transitions.** Keep an `isAdvertising` boolean and a stored
`lastPayload`, mutated only on the main thread. The stop→start cycle in
`updatePayload` is where races appear.

**Permission checks (API 31+).** Check `BLUETOOTH_ADVERTISE` at the top of every
public method and reject with `PERMISSION_DENIED` rather than letting a
`SecurityException` propagate. On API < 31 this permission does not exist —
branch on `Build.VERSION.SDK_INT`.

**Getting the advertiser:**

```kotlin
val manager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
val adapter = manager?.adapter
val advertiser = adapter?.bluetoothLeAdvertiser   // null if unsupported OR BT off
```

`bluetoothLeAdvertiser` returns null both when the feature is unsupported *and*
when Bluetooth is simply switched off. Distinguish these before reporting —
check `adapter.isEnabled` first, otherwise a user with Bluetooth off is told
their phone is incapable.

**Payload length check** before the platform call. Reject over-24-byte payloads
with `PAYLOAD_TOO_LARGE` rather than letting the stack return the vaguer
`DATA_TOO_LARGE`.

---

## 8. Manual verification (task P1-6)

Before writing any scanner code, verify the advertiser independently with a
generic BLE scanner (nRF Connect):

1. Start advertising a known static payload.
2. Confirm the device appears in the scanner.
3. Confirm manufacturer data is present under company ID `0xFFFF`.
4. Confirm the bytes match the expected encoding exactly.
5. Leave it running 20 minutes and confirm the advertisement persists — this
   catches an accidental non-zero timeout.

This isolates the transmit path completely. Debugging a broken advertiser and a
broken scanner simultaneously is the single most avoidable time sink in this
project.

---

## 9. Definition of done

- [ ] Both Kotlin files written and package registered
- [ ] All five public methods implemented and typed in `advertiser.ts`
- [ ] All error codes mapped; no raw integers reach JavaScript
- [ ] Events emitted on the main thread
- [ ] Lifecycle stop/restart working with no leaked advertisers
- [ ] Verified in nRF Connect per §8
- [ ] `isSupported()` correctly distinguishes "Bluetooth off" from
      "advertising unsupported" on a test device with Bluetooth disabled
