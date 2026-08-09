# BUILD.md — building and running AuraBridge

This repo contains the **complete application source** (TypeScript + the Kotlin
native advertiser + the Android manifest), plus a fully unit-tested pure-logic
core. What it does **not** contain is the generated React Native Android shell
(Gradle wrapper, `MainActivity`/`MainApplication`, `settings.gradle`, icons),
because that is produced by the RN toolchain on a dev machine and is
version-specific. This file is the recipe to assemble a runnable app.

> Nothing in this project can be validated in an emulator — no BLE radio, no
> ARCore, no compass. You need **two physical Android devices** (API 26+, both
> able to advertise — see the capability screen). See CLAUDE.md §8.

---

## 0. What's already done and verified

- `npm test` → the pure core (payload codec, base64, republish policy, identity,
  RSSI/distance/proximity, alignment, bond hysteresis + staleness, per-peer
  fusion engine, effect math) is unit-tested. **106 tests, all passing.**
- `npm run typecheck` → the core typechecks under `tsconfig.json` (strict).

These run with only `typescript` + `vitest` installed and need no device.

---

## 1. Generate the RN shell

Use the same RN version as `package.json` (0.74.5):

```bash
npx @react-native-community/cli init AuraBridge --version 0.74.5 --directory .rn-shell
```

Then copy the shell's project scaffolding into this repo **without overwriting
`src/`, `android/app/src/main/AndroidManifest.xml`, or the config files already
here**:

- `.rn-shell/android/` → `android/` (keep our `AndroidManifest.xml` and the
  `com/aurabridge/ble/` Kotlin files)
- `.rn-shell/Gemfile`, `.rn-shell/.watchmanconfig`, etc. as needed

Our `package.json`, `app.json`, `babel.config.js`, `metro.config.js`,
`index.js`, `tsconfig*.json` are authoritative — keep them.

## 2. Install dependencies

```bash
npm install
npm run typecheck:app   # now checks the RN/native/AR layers too
```

## 3. Register the native advertiser package

In `android/app/src/main/java/com/aurabridge/MainApplication.kt`, add our package
to the list:

```kotlin
import com.aurabridge.ble.BleAdvertiserPackage

override fun getPackages(): List<ReactPackage> =
    PackageList(this).packages.apply {
      add(BleAdvertiserPackage())
    }
```

Confirm `applicationId` is `com.aurabridge` (see `android/app/build.gradle`) and
`getMainComponentName()` returns `"AuraBridge"` to match `app.json`.

## 4. Viro / ARCore setup

Follow the `@reactvision/react-viro` Android install notes (it links natively to
ARCore). Ensure `minSdkVersion` ≥ 24 in `android/build.gradle` (we target API 26
per CLAUDE.md; Viro requires ≥ 24).

## 5. Assets

`src/ar/particle.png` is an **8×8 placeholder glow** committed so the bundler
resolves. Replace it with a real soft particle sprite before Phase 3 tuning.

## 6. Run

```bash
npm start                 # Metro
npm run android           # build + install on a connected device
```

Repeat on the second device. Grant Bluetooth + Camera when prompted.

---

## 7. Phase gates (device testing — TASKS.md)

Run these in order; do not skip ahead.

- **P1-6 (before trusting the scanner):** with nRF Connect, confirm the phone
  advertises manufacturer data under company id `0xFFFF` with the expected bytes,
  and that it persists for 20 min (catches a stray non-zero timeout).
- **Gate P1:** each device shows the other in the HUD within 3 s, ≥ 2 packets/s
  at 2 m, `peerId` stable for a 20-minute session (proves the MAC-randomisation
  handling), and the peer disappears/reappears cleanly on a walk to 10 m and back.
- **P2-2 (calibration):** measure RSSI at exactly 1 m per model for 30 s, record
  in `docs/CALIBRATION.md`, and add the value to `TX_POWER_BY_MODEL` in
  `src/calibration.ts`.
- **Gate P2:** at 2 m the HUD distance varies < ±0.5 m over 30 s; turning away
  drops `alignment` < 0.2 within 1.5 s; `bonded` doesn't flicker at threshold;
  both devices agree on `bonded` within ~500 ms.
- **Gate P3:** two people walk together, face, and both see a bridge form; it
  doesn't strobe and survives a grip shift.
- **Gate P4:** hand both phones to two newcomers; if they figure it out and
  react, done.

The HUD (three-finger/corner long-press to toggle) exposes every intermediate
number and live sliders for α, n, D_NEAR, D_FAR, TOLERANCE, and the bond
thresholds — tune on-device rather than rebuilding.

---

## 8. Known scaffolding placeholders

| Item | Status |
|---|---|
| `src/ar/arcore.ts` | Returns "assumed available on Android". Bridge `ArCoreApk.checkAvailability()` for an honest capability report. |
| `src/ar/particle.png` | 8×8 placeholder sprite. |
| `react-native-compass-heading` | Chosen over `react-native-sensors` because it yields heading **and** the accuracy value payload byte 7 needs. |
| `TX_POWER_BY_MODEL` | Empty until on-device calibration (P2-2). Falls back to −59 dBm. |
| RN shell (Gradle, MainActivity/Application) | Generated per §1, not committed. |
