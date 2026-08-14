#!/usr/bin/env bash
#
# Refresh an EXISTING ios-shell/ with the latest app source after a `git pull`,
# without regenerating the project (so your Xcode signing + Info.plist survive).
#
# Use this instead of `cp -R src ios-shell/src` — that command NESTS src into
# ios-shell/src/src when the folder already exists, so your changes never apply.
set -euo pipefail

SHELL_DIR="ios-shell"
if [ ! -d "${SHELL_DIR}" ]; then
  echo "No ${SHELL_DIR}/ found — run scripts/ios-setup.sh first."
  exit 1
fi

echo "==> Replacing JS overlay (clean, no nesting)"
rm -rf "${SHELL_DIR}/src"
cp -R src "${SHELL_DIR}/src"
cp index.js app.json babel.config.js metro.config.js "${SHELL_DIR}/"

echo "==> Refreshing native Swift files (BlePeripheral, Heading, Sound)"
mkdir -p "${SHELL_DIR}/ios/AuraBridge/native"
cp ios/AuraBridge/BlePeripheral.swift \
   ios/AuraBridge/BlePeripheral.m \
   ios/AuraBridge/Heading.swift \
   ios/AuraBridge/Heading.m \
   ios/AuraBridge/Sound.swift \
   ios/AuraBridge/Sound.m \
   ios/AuraBridge/AuraBridge-Bridging-Header.h \
   "${SHELL_DIR}/ios/AuraBridge/native/"

# The Xcode target references these native files at the ios/ ROOT (an old copy
# added during first setup — see IOS_SETUP.md). ALWAYS ensure the root copies exist
# and are current: syncing only pre-existing duplicates (below) can't recreate a
# root copy that went missing (e.g. after a git shuffle), which fails the build with
# "Build input files cannot be found". Copy them unconditionally first.
echo "==> Ensuring root native copies exist (Xcode target references ios/ root)"
for f in BlePeripheral.swift BlePeripheral.m Heading.swift Heading.m Sound.swift Sound.m AuraBridge-Bridging-Header.h; do
  cp "ios/AuraBridge/$f" "${SHELL_DIR}/ios/$f"
done

# Also refresh any OTHER duplicate Xcode might reference (a copy somewhere other
# than native/ or the root), so a changed Swift file never silently stays stale.
echo "==> Syncing any duplicate native copies Xcode may reference"
for f in BlePeripheral.swift BlePeripheral.m Heading.swift Heading.m Sound.swift Sound.m AuraBridge-Bridging-Header.h; do
  while IFS= read -r dup; do
    [ "$dup" = "${SHELL_DIR}/ios/AuraBridge/native/$f" ] && continue
    [ "$dup" = "${SHELL_DIR}/ios/$f" ] && continue
    cp "ios/AuraBridge/$f" "$dup"
    echo "    synced duplicate: $dup"
  done < <(find "${SHELL_DIR}/ios" -name "$f" -not -path '*/Pods/*')
done

if [ -n "${FIREBASE_API_KEY:-}" ]; then
  echo "==> Refreshing Firebase config from FIREBASE_* env vars"
  node scripts/gen-firebase-config.js "${SHELL_DIR}/src/lib/firebaseConfig.ts"
fi

cat <<'NEXT'

==> JS + native files refreshed.

To make sure the phone runs the NEW JavaScript (this is what was stale):
  1. If a Metro bundler terminal is open, stop it (Ctrl+C).
  2. In Xcode: Product > Clean Build Folder (Shift+Cmd+K).
  3. Run again. (For a debug build it restarts Metro fresh; for release it
     re-bundles the JS into the app.)

Then check the iPhone HUD:
  - `scan` should no longer say "unknown state".
  - `advertising` should say "running", OR the explicit
    "BlePeripheral module missing …" (meaning the Swift files still aren't in the
    Xcode target — see docs/IOS_SETUP.md §6).
NEXT
