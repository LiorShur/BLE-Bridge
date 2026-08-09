# `src/` — implementation status

This first pass implements the **pure, off-device-testable core** the specs
single out as "the parts you cannot debug by looking at a phone" (CLAUDE.md §7).
Everything here is pure functions with unit tests and no React Native / radio /
platform dependency, so it can be proven correct without two Android devices.

Run `npm test` (Vitest) and `npm run typecheck` (tsc strict) from the repo root.

## Implemented and tested

| Module | Spec | Tests |
|---|---|---|
| `ble/payload.ts` | PAYLOAD_SPEC.md — big-endian 24-byte codec, all §6 reject/tolerate rules | `ble/payload.test.ts` |
| `signal/rssi.ts` | CLAUDE.md §4.1–4.2 — EMA smoothing, log-distance model, proximity | `signal/rssi.test.ts` |
| `signal/alignment.ts` | CLAUDE.md §4.3 — heading opposition + low-accuracy fallback | `signal/alignment.test.ts` |
| `signal/bond.ts` | CLAUDE.md §3.4, §4.4 — hysteresis + staleness state machine (injected time) | `signal/bond.test.ts` |

Covers tasks **P1-1/P1-2** and **P2-1/P2-3/P2-6/P2-7** from TASKS.md.

## Not yet built (needs a device — cannot be validated in this environment)

- `ble/advertiser.ts`, `ble/scanner.ts`, `ble/useNearbyPeers.ts` — native/RN glue
- `android/.../BleAdvertiserModule.kt` (+ package) — Kotlin advertiser (P1-3)
- `ar/`, `debug/`, `state/` — Viro scene, HUD, Zustand store
- RN project scaffold, manifest permissions, capability screen (Phase 0)
- On-device calibration → `docs/CALIBRATION.md` (P2-2)

These are deliberately deferred: they compile and run only against ARCore, a BLE
radio, and a compass, so pushing them here would be unverified. The signal-layer
contract they plug into (`BondState`, `PeerSnapshot`) is fixed and tested.

## Note on doc paths

CLAUDE.md §5 and the task list reference the specs under `docs/`, but the three
spec files currently live at the repo root. Code references above point at the
actual root locations; the files were left in place rather than moved.
