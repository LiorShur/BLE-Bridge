#!/usr/bin/env bash
#
# P-i2a iOS bring-up — run on a Mac with Xcode + CocoaPods installed, from the
# repo root. Generates a pristine RN 0.74.5 iOS shell, overlays our app source,
# installs the JS deps, injects the Firebase config, and runs `pod install`.
#
# After it finishes: open ios-shell/ios/AuraBridge.xcworkspace in Xcode, set your
# Team + bundle id (com.aurabridge.app) under Signing & Capabilities, add the
# Info.plist usage strings from docs/IOS_SETUP.md, and Run to your iPhone.
#
# This mirrors what the Android CI does, but for iOS and locally. It is a STARTING
# point — expect to iterate on Xcode build errors (untested on this machine).
set -euo pipefail

RN_VERSION=0.74.5
CLI="@react-native-community/cli@13.6.9"
SHELL_DIR="ios-shell"

echo "==> Generating RN ${RN_VERSION} iOS shell in ${SHELL_DIR}/"
rm -rf "${SHELL_DIR}"
npx --yes "${CLI}" init AuraBridge --version "${RN_VERSION}" \
  --directory "${SHELL_DIR}" --skip-install --skip-git-init --pm npm

echo "==> Overlaying app source"
cd "${SHELL_DIR}"
rm -f App.tsx
rm -rf __tests__
cp -R ../src ./src
cp ../index.js ../app.json ../babel.config.js ../metro.config.js ./

echo "==> Installing JS dependencies"
npm install
npm install --save \
  react-native-ble-plx@^3.2.1 \
  zustand@^4.5.4 \
  react-native-vision-camera@4.5.3 \
  firebase@^10.12.0 \
  @react-native-async-storage/async-storage@^1.23.1 \
  react-native-image-picker@^7.1.2

echo "==> Copying native Swift modules into the iOS project"
# P-i2b+: the CBPeripheralManager (BlePeripheral), CoreLocation compass (Heading),
# and audio+haptic (Sound) modules. These files must be ADDED to the Xcode target
# manually (see docs/IOS_SETUP.md §6) — copying them here just puts them in a
# predictable place next to the generated project.
mkdir -p ios/AuraBridge/native
cp ../ios/AuraBridge/BlePeripheral.swift ios/AuraBridge/native/
cp ../ios/AuraBridge/BlePeripheral.m ios/AuraBridge/native/
cp ../ios/AuraBridge/Heading.swift ios/AuraBridge/native/
cp ../ios/AuraBridge/Heading.m ios/AuraBridge/native/
cp ../ios/AuraBridge/Sound.swift ios/AuraBridge/native/
cp ../ios/AuraBridge/Sound.m ios/AuraBridge/native/
cp ../ios/AuraBridge/AuraBridge-Bridging-Header.h ios/AuraBridge/native/

echo "==> Injecting Firebase config (needs FIREBASE_* env vars exported)"
if [ -z "${FIREBASE_API_KEY:-}" ]; then
  echo "    WARNING: FIREBASE_API_KEY not set — profiles will be disabled."
  echo "    Export the FIREBASE_* vars (same values as the GitHub secrets) and re-run,"
  echo "    or paste your config into ${SHELL_DIR}/src/lib/firebaseConfig.ts by hand."
fi
node ../scripts/gen-firebase-config.js src/lib/firebaseConfig.ts

echo "==> pod install"
cd ios
pod install
cd ..

cat <<'NEXT'

==> Done.

Open ios-shell/ios/AuraBridge.xcworkspace in Xcode, then:
  1. Select the AuraBridge target -> Signing & Capabilities:
       - Team: your Apple ID / team
       - Bundle Identifier: com.aurabridge.app
  2. Add the usage strings to Info.plist (see docs/IOS_SETUP.md §4).
  3. Plug in your iPhone, select it as the run destination, and press Run.

P-i2a scope: the iPhone runs as a GATT CENTRAL. Point it at a nearby Android that
has interop (GATT) enabled and stand close — the bridge should form on the iPhone.
The iPhone is not yet discoverable by Android and has no compass/sound (that's the
P-i2b Swift step).
NEXT
