# BUILD.md — building, installing, and testing AuraBridge

Two physical Android phones are required to test anything real (BLE has no
emulator). This project ships in two stages so you get a working, installable app
fast, then add the AR magic.

| Stage | What you get | Deps | Build reliability |
|---|---|---|---|
| **1 (now)** | BLE discovery + signal engine + **multi-peer 2D bridge** view + HUD. No camera/AR, no compass (bonds form on proximity). | ble-plx, slider, zustand | High — plain RN, builds in CI |
| **2 (next)** | Swap the 2D view for the **ViroAR** camera bridge; add compass "face each other" gate. | + Viro + compass-heading | Viro linking is the finicky part |

The stage is controlled by `src/config.ts` (`AR_ENABLED`, `HEADING_ENABLED`).

---

## Getting the Stage 1 APK (no dev tools needed)

CI builds a **standalone, sideloadable APK** on every push to the working branch
(`.github/workflows/android-build.yml`). It's a debug-keystore-signed *release*
build, so the JS is bundled and it runs without a Metro server.

1. Open the repo's **Actions** tab → the latest **"Android APK (Stage 1)"** run.
2. Download the **`aurabridge-stage1-apk`** artifact (a zip) and unzip it.
3. On each phone: allow installing from your file manager/browser
   ("Install unknown apps"), then open the APK to install.
4. Launch on **both** phones, grant Bluetooth when asked, and walk them together —
   each should show the other as a forming/connected bridge. Long-press the
   top-right corner to reveal the debug HUD (per-peer RSSI, distance, strength,
   packet rate, and live tuning sliders).

> The `0xFFFF` company id and the debug keystore make this a **test build only** —
> not for public distribution.

### What Stage 1 proves on your phones (the hard part)

- Both phones discover each other over connectionless BLE within a few seconds.
- `peerId` stays stable across the session (MAC randomisation handled — §3.3).
- Proximity tracks distance; the bridge forms as you approach and fades as you
  part; multiple people each get their own bridge.

---

## Local build (optional, needs Android Studio / SDK)

The CI job is the source of truth for the exact steps; to reproduce locally:

```bash
# 1. Generate the RN shell (same version as package.json)
npx react-native@0.74.5 init AuraBridge --directory shell --skip-install --pm npm
# 2. Overlay this repo's app code
cp -R src shell/src && cp index.js app.json babel.config.js metro.config.js shell/
mkdir -p shell/android/app/src/main/java/com/aurabridge/ble
cp android/app/src/main/java/com/aurabridge/ble/*.kt shell/android/app/src/main/java/com/aurabridge/ble/
cp android/app/src/main/AndroidManifest.xml shell/android/app/src/main/AndroidManifest.xml
# 3. Deps + register the native package
cd shell && npm install && npm install react-native-ble-plx @react-native-community/slider zustand
#    then add `add(com.aurabridge.ble.BleAdvertiserPackage())` inside
#    getPackages() in android/.../com/aurabridge/MainApplication.kt
# 4. Build + install (device connected)
npm run android            # or: cd android && ./gradlew assembleRelease
```

---

## Verified without a device

- `npm test` → pure core (payload codec, base64, framing, republish policy,
  identity, RSSI/distance/proximity, alignment, bond hysteresis + staleness,
  per-peer fusion incl. multi-peer selection, effect math). **108 tests.**
- `npm run typecheck` → strict typecheck of that core.

---

## Stage 2 — turning on AR

1. In `src/config.ts` set `AR_ENABLED = true` and `HEADING_ENABLED = true`.
2. Add deps: `@reactvision/react-viro`, `react-native-compass-heading` (add them
   to the CI install step and `package.json`).
3. Point `App.tsx` at the Viro experience (`ar/BridgeScene.tsx`) and
   `sensors/useCompassHeading.ts`; re-include those in `tsconfig.app.json`.
4. Restore camera + ARCore entries in `AndroidManifest.xml` (camera permission,
   `uses-feature android.hardware.camera.ar`, `com.google.ar.core` meta-data).
5. Follow the `@reactvision/react-viro` Android setup; iterate the CI build.

Do this only after Stage 1 is solid on two devices (CLAUDE.md §9 phase gate).

---

## Phase gates (device testing — TASKS.md)

- **Gate P1:** each device shows the other in the HUD within 3 s, ≥ 2 packets/s at
  2 m, `peerId` stable for 20 min; peer disappears/reappears cleanly at 10 m.
- **P2-2 calibration:** measure RSSI at 1 m per model → `docs/CALIBRATION.md` +
  `TX_POWER_BY_MODEL` in `src/calibration.ts`.
- **Gate P2:** distance varies < ±0.5 m over 30 s at 2 m; `bonded` doesn't
  flicker at threshold; both devices agree within ~500 ms.
- **Gate P3/P4 (Stage 2):** two people face each other and both see a bridge form;
  it doesn't strobe; hand it to newcomers and watch.

---

## Known placeholders

| Item | Status |
|---|---|
| RN shell (Gradle, MainActivity/Application, res/) | Generated in CI, not committed. |
| `src/ar/arcore.ts` | Stub "assumed available"; bridge `ArCoreApk.checkAvailability()` in Stage 2. |
| `src/ar/particle.png` | 8×8 placeholder sprite (Stage 2 AR). |
| `TX_POWER_BY_MODEL` | Empty until on-device calibration; falls back to −59 dBm. |
