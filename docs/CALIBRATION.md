# CALIBRATION.md — per-model txPower

`txPower` is the calibrated RSSI (dBm) measured at **exactly 1 m** for a given
device model. Each device advertises its OWN value; the receiver uses the
**peer's** advertised value in the distance model (docs/PAYLOAD_SPEC.md §3). This
is the single biggest source of asymmetry between two phones, so measure it.

## Procedure (TASKS.md P2-2)

1. Place the two devices exactly 1 m apart in an open space (no walls/bodies in
   the first metre).
2. Advertise from device A; scan with device B. Record device B's RSSI for A
   over **30 seconds** using the debug HUD (`rssi` column).
3. Take the mean; round to the nearest integer dBm. That is device A's `txPower`.
4. Swap roles and repeat for device B.
5. Enter the value in `src/calibration.ts` → `TX_POWER_BY_MODEL[Build.MODEL]`.

## Measured values

_None yet — placeholders in code fall back to −59 dBm._

| `Build.MODEL` | Marketing name | txPower (dBm @ 1 m) | Date | Notes |
|---|---|---:|---|---|
| _e.g. Pixel 7_ | | | | |

> Keep this table and `TX_POWER_BY_MODEL` in `src/calibration.ts` in sync.
