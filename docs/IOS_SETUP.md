# iOS bring-up (P-i2)

How to build and run AuraBridge on an iPhone, and what works at each stage. This
is the interop target from `docs/IOS_INTEROP.md` / `docs/GATT_SPEC.md`: an iPhone
speaks the **GATT** path (it cannot use the connectionless manufacturer-data path).

Prereqs: a **Mac with Xcode**, **CocoaPods** (`sudo gem install cocoapods`), an
**Apple ID** added to Xcode (Settings → Accounts), and an **iPhone**. Bundle id:
`com.aurabridge.app`.

---

## Staged plan

- **P-i2a — iPhone as GATT central (this doc, minimal Swift).** `react-native-
  ble-plx` provides the iOS central natively, so the iPhone can scan for the
  Bridge service UUID, connect to an interop-enabled Android, read its payload
  characteristic, and **form the bridge on the iPhone** — no custom Swift needed.
  The iPhone is *not yet discoverable* by Android and has *no compass/sound*.
  Bonding runs proximity-led (heading absent → the alignment fallback applies).
- **P-i2b — Swift peripheral + sensors.** A `CBPeripheralManager` module makes the
  iPhone advertise the service UUID + host the Bridge GATT server (so Android can
  discover and connect to it → full two-way), plus Swift heading (CoreLocation)
  and sound. This is the next increment.

The app is already iOS-aware for P-i2a: on iOS, GATT is on by default, the
(Android-only) advertiser is not mounted, and the capability gate passes.

---

## 1. Generate the iOS project

From the repo root on your Mac:

```bash
# optional: export your Firebase values (same as the GitHub secrets) so profiles work
export FIREBASE_API_KEY=... FIREBASE_AUTH_DOMAIN=... FIREBASE_PROJECT_ID=... \
       FIREBASE_STORAGE_BUCKET=... FIREBASE_APP_ID=...

bash scripts/ios-setup.sh
```

This creates `ios-shell/` (a pristine RN 0.74.5 project) with our `src/` overlaid,
the JS deps installed, the Firebase config injected, and pods installed. It's the
iOS analogue of what the Android CI does — kept out of git like the Android shell.

## 2. Open in Xcode & sign

Open **`ios-shell/ios/AuraBridge.xcworkspace`** (the *workspace*, not the project).

- Select the **AuraBridge** target → **Signing & Capabilities**:
  - **Team:** your Apple ID / team.
  - **Bundle Identifier:** `com.aurabridge.app`.
  - Leave "Automatically manage signing" on. For running on your own device a
    free Apple ID works (7-day certs); a paid account is needed later for ad-hoc
    distribution to other people's devices.

## 3. Run

Plug in the iPhone, trust the computer, select it as the run destination, press
**Run** (▶). First launch will prompt for Bluetooth and Camera — allow both.

## 4. Info.plist — required usage strings

RN 0.74's default Info.plist won't have these; add them (Xcode: select
`Info.plist` → right-click → Add Row, or edit the source):

| Key | Value (example) |
|---|---|
| `NSBluetoothAlwaysUsageDescription` | AuraBridge uses Bluetooth to find nearby people and form the bridge. |
| `NSCameraUsageDescription` | AuraBridge shows the bridge over the live camera. |
| `NSPhotoLibraryUsageDescription` | Pick a profile photo from your library. |
| `NSLocationWhenInUseUsageDescription` | Used for the compass heading (facing detection). |

(The last one isn't exercised until P-i2b's heading module, but add it now.)

## 5. Test P-i2a (Android ↔ iPhone, one-way discovery)

1. On your **Android** (the Xiaomi), open the debug HUD → **GATT: ON** (so it
   advertises the service UUID, connectable, and hosts the GATT server).
2. On the **iPhone**, launch the app and grant permissions.
3. Stand the two devices **close** (< ~0.5 m) and point the iPhone camera toward
   the Android.
4. Expected: the iPhone discovers the Android's Bridge service, connects, reads
   the payload, and the **bridge forms on the iPhone** (proximity-led). The
   Android won't show the iPhone yet — that's P-i2b.

If it doesn't connect, note the iPhone's on-screen state and (if you wire it) any
Xcode console `CoreBluetooth` logs, and we'll iterate.

## 6. Add the Swift peripheral (P-i2b) — makes the iPhone discoverable

P-i2a only makes the iPhone a *central* (it reads Androids over their normal
advertisement). To let **Android discover the iPhone**, add the native
`CBPeripheralManager` module. `scripts/ios-setup.sh` already copied the files to
`ios-shell/ios/AuraBridge/native/`; add them to the Xcode target:

1. In Xcode's left sidebar, right-click the **AuraBridge** group → **Add Files to
   "AuraBridge"…** → select **`BlePeripheral.swift`** and **`BlePeripheral.m`**
   from `ios/AuraBridge/native/`. Make sure **"AuraBridge" target is checked**.
2. Xcode will ask **"Would you like to configure an Objective-C bridging
   header?"** → click **Create Bridging Header**. Open the created
   `AuraBridge-Bridging-Header.h` and make sure it contains:
   ```objc
   #import <React/RCTBridgeModule.h>
   ```
   (copy it from `native/AuraBridge-Bridging-Header.h` if needed).
3. Build & Run again.

The app mounts the iOS peripheral automatically on iOS. Once it's running, the
HUD's `advertising` / `server` lines go to "running", and an interop-enabled
Android that comes close should be able to discover the iPhone's Bridge service.

### Verify P-i2b independently with nRF Connect

Before wiring the Android side, confirm the iPhone is really advertising: install
**nRF Connect** (free, App Store/Play Store) on any other phone, scan, and you
should see a device advertising service UUID
`A0E1B5D2-7C3F-4E8A-9B10-2F6C1D4E7A90` with a readable/notifiable characteristic
`…7A91` whose value is 24 bytes. That proves the peripheral works.

> **Note:** Android *seeing* the iPhone in the app (not just nRF Connect) also
> needs a small Android change (P-i3) so it connects to service-UUID peers that
> carry no manufacturer data — that's the next step after P-i2b is confirmed.

---

## Notes & known gaps

- **iPhone advertising** requires the P-i2b Swift module (§6). Until it's added,
  the iPhone is central-only and Android can't discover it.
- **No heading on iPhone** → alignment uses the proximity-led fallback; the
  "face each other" gate isn't enforced from the iPhone side yet (a Swift
  CoreLocation heading module is a later step).
- **Profiles on iOS**: the Firebase JS SDK's Firestore can't reach its backend
  reliably under iOS RN ("could not reach backend"), so names/photos may not load
  on the iPhone. Non-fatal (the bridge works without them); the robust fix is the
  native `@react-native-firebase` SDK, tracked separately.
- **No sound/haptics on iPhone** → the audio cues are Android-only until the Swift
  sound module lands.
- **txPower**: iOS doesn't expose the advertised TX reference; when the iPhone
  becomes a peripheral (P-i2b) it will advertise a per-model constant from
  `docs/CALIBRATION.md`.
- **Distribution**: this runs via Xcode to your own device. Ad-hoc `.ipa` for
  other testers (and/or a macOS CI) is a later step — see `docs/IOS_INTEROP.md` §6.
