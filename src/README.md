# `src/` — implementation status

The app is implemented end-to-end against the specs. It splits cleanly into a
**pure, off-device-testable core** (unit-tested here, 106 tests) and the
**React Native / native / AR layers** (faithful to the library + spec APIs, but
buildable and verifiable only on two physical Android devices — see `BUILD.md`).

Run `npm test` (Vitest) and `npm run typecheck` (tsc strict, core) from the repo
root. `npm run typecheck:app` checks the RN layers once deps are installed.

## Pure core — implemented AND unit-tested

| Module | Spec | Tests |
|---|---|---|
| `ble/payload.ts` | PAYLOAD_SPEC — big-endian 24-byte codec, §6 reject/tolerate | `ble/payload.test.ts` |
| `ble/base64.ts` | RN-safe base64 for the advertise/scan boundary | `ble/base64.test.ts` |
| `ble/manufacturer.ts` | ble-plx LE company-id framing (strip `0xFFFF`) | `ble/manufacturer.test.ts` |
| `ble/republish.ts` | PAYLOAD_SPEC §7 — republish policy (>5° / 1 s) | `ble/republish.test.ts` |
| `ble/identity.ts` | §4 — random uint32 session peerId | `ble/identity.test.ts` |
| `signal/rssi.ts` | §4.1–4.2 — EMA, log-distance, proximity | `signal/rssi.test.ts` |
| `signal/alignment.ts` | §4.3 — heading opposition + fallback | `signal/alignment.test.ts` |
| `signal/bond.ts` | §3.4, §4.4 — hysteresis + staleness (injected time) | `signal/bond.test.ts` |
| `signal/engine.ts` | per-peer fusion + primary-peer selection | `signal/engine.test.ts` |
| `ar/effects.ts` | visual binding math (easing, hue→rgb, emission) | `ar/effects.test.ts` |
| `calibration.ts` | §3 — per-model txPower resolution | `calibration.test.ts` |

## RN / native / AR layers — implemented, device-verified only

| Area | Files |
|---|---|
| Native advertiser (Kotlin) | `android/.../ble/BleAdvertiserModule.kt`, `BleAdvertiserPackage.kt` |
| Advertiser JS wrapper | `ble/advertiser.ts` |
| Scanner | `ble/scanner.ts`, hook `ble/useNearbyPeers.ts` |
| Outgoing payload lifecycle | `ble/useAdvertiser.ts` |
| Compass heading | `sensors/useHeading.ts` |
| Signal engine (React glue) | `signal/useBondEngine.ts` |
| State | `state/store.ts` (Zustand) |
| AR scene + HUD | `ar/BridgeScene.tsx`, `debug/DebugHUD.tsx` |
| Permissions / capability / onboarding | `permissions.ts`, `ar/arcore.ts`, `screens/*` |
| Root wiring | `App.tsx`, `index.js` |

## Architecture boundary (CLAUDE.md §3.4)

```
BLE scan ─┐
          ├─ engine.ts (pure) ─► BondState { proximity, alignment, strength, bonded, peer }
heading ──┘                        │
                                   └─► store ─► BridgeScene (AR) + DebugHUD
```

The AR layer reads only the four numbers; it knows nothing about Bluetooth. When
Cloud Anchors / UWB land, they replace the producer of those numbers and add
`peerPosition` (already a prop on `BridgeScene`) — the AR layer is untouched.

## Task coverage (TASKS.md)

Phase 0–2 logic and Phase 3 effect math are implemented. What remains is
device-only: `BUILD.md` §7 lists the acceptance gates, on-device calibration
(P2-2), and the scaffolding placeholders (§8) — ARCore availability check,
particle sprite, and generating the RN Gradle shell.

## Doc locations

`PAYLOAD_SPEC.md` and `BLE_ADVERTISER_MODULE.md` live under `docs/` (CLAUDE.md
§5). `CLAUDE.md` and `TASKS.md` stay at the repo root.
