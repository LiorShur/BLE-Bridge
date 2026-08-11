# iOS distribution — getting the app onto other people's iPhones

You're already running the app on **your own** iPhone from Xcode. That uses a
free personal signing team and the install **expires after 7 days**. To hand a
build to a friend's iPhone you need one of the paths below.

> **Hard prerequisite for every path here: a paid Apple Developer Program
> membership ($99/year).** Ad Hoc, TestFlight, and CI signing all require it.
> A free Apple ID can only sideload to *your* device for 7 days — there is no
> exception. Enrol at <https://developer.apple.com/programs/> before starting.

**The golden rule for credentials:** never paste a certificate, `.p12`, private
key, provisioning profile, or password into chat. Local paths (A, B) keep the
secrets on your Mac. The CI path (C) puts them in **GitHub → repo Settings →
Secrets and variables → Actions**, base64-encoded — never in a file or a message.

---

## Which path?

| Path | Effort | Who can install | Best when |
|---|---|---|---|
| **A. Ad Hoc via Xcode** | Lowest | Devices whose UDID you registered (max 100/yr) | A handful of known testers, fastest iteration. **Recommended first.** |
| **B. TestFlight via Xcode** | Medium | Anyone you invite by email/link (up to 10k) | The tester list grows, or you don't want to collect UDIDs. |
| **C. macOS GitHub Actions → `.ipa`/TestFlight** | Highest | Same as A or B | You want the Android-style "push → build appears" flow. Do this *after* A or B works by hand. |

For this PoC (a few phones you physically have), **Path A** is the shortest road
to "whoa on a second iPhone". Everything below is ordered so you can stop after A.

---

## Path A — Ad Hoc export from Xcode (recommended)

### A1. Register the tester devices (one-time per device)

Ad Hoc builds only install on devices baked into the provisioning profile.

1. Get each iPhone's **UDID**: plug it into the Mac → open **Finder** → click the
   device → click the text under its name until it shows *UDID* → right-click →
   **Copy UDID**. (Or: Xcode → Window → Devices and Simulators → Identifier.)
2. At <https://developer.apple.com/account> → **Devices** → **+** → paste each
   UDID, give it a name, register.

### A2. One-time signing setup in Xcode

1. Open `ios-shell/ios/AuraBridge.xcworkspace`.
2. Select the **AuraBridge** target → **Signing & Capabilities**.
3. **Team**: your paid team (not the personal one). **Bundle Identifier**:
   `com.aurabridge.app`. Leave **Automatically manage signing** ON — Xcode will
   create the distribution cert and an Ad Hoc profile that includes your
   registered devices.

### A3. Archive & export

1. Set the run destination to **Any iOS Device (arm64)** (not the simulator, not
   a specific phone).
2. **Product → Archive**. When it finishes the **Organizer** opens.
3. Select the archive → **Distribute App** → **Release Testing (Ad Hoc)** →
   **Next** through the defaults → **Export**.
4. You get a folder containing **`AuraBridge.ipa`**.

### A4. Install on a tester's iPhone

Any one of:
- **Apple Configurator** (Mac, free): drag the `.ipa` onto the connected iPhone.
- **Xcode → Devices and Simulators** → select device → **+** under *Installed
  Apps* → pick the `.ipa`.
- A service like **Diawi**/**InstallOnAir** (uploads the `.ipa`, gives a link the
  tester opens on their iPhone). Fine for a PoC; it's your build, but the file
  does pass through a third party — don't use it for anything sensitive.

The app runs for **1 year** (until the Ad Hoc profile expires), no 7-day limit.

---

## Path B — TestFlight (invite by email, no UDIDs)

Better once you stop wanting to collect UDIDs.

1. At <https://appstoreconnect.apple.com> → **Apps → +** → **New App**. Platform
   iOS, bundle id `com.aurabridge.app`, pick a name/SKU.
2. In Xcode, archive exactly as **A3**, but choose **Distribute App → TestFlight
   (& App Store) → Upload**.
3. In App Store Connect → your app → **TestFlight**: the build appears after
   processing (a few minutes). Internal testers (up to 100, on your team) get it
   immediately. For **external** testers you add them to a group and submit the
   build for a light **Beta App Review** (usually < a day).
4. Testers install the free **TestFlight** app and tap your invite link. Builds
   last **90 days**.

Camera + Bluetooth + Location usage strings must be present (they are, per
`IOS_SETUP.md §4`) or the upload is rejected.

---

## Path C — Automated macOS CI (do this last)

Only worth it once Path A/B works by hand — CI just automates the exact archive
+ export you already did. It mirrors the Android APK workflow but on a
`macos-latest` runner, which costs more minutes and is the fiddliest part of the
whole project because of code signing.

### C1. Secrets to create (all in GitHub Actions secrets, never in chat)

Collect these on your Mac, base64-encode the binary ones, and paste each into
**repo Settings → Secrets and variables → Actions → New repository secret**:

| Secret name | What it is / how to get it |
|---|---|
| `IOS_DIST_CERT_P12_BASE64` | Your **Apple Distribution** certificate + private key exported from **Keychain Access → your cert → right-click → Export → .p12**, then `base64 -i cert.p12 \| pbcopy`. |
| `IOS_DIST_CERT_PASSWORD` | The password you set when exporting the `.p12`. |
| `IOS_ADHOC_PROFILE_BASE64` | The Ad Hoc **provisioning profile** (`.mobileprovision`) downloaded from the Developer portal (or `~/Library/MobileDevice/Provisioning Profiles/` after Xcode made one), `base64`-encoded. |
| `IOS_KEYCHAIN_PASSWORD` | Any random string; the workflow uses it to create a throwaway keychain. |
| `IOS_TEAM_ID` | Your 10-char Team ID (Developer portal → Membership). |

For **TestFlight upload** from CI, add an **App Store Connect API key** instead of
your Apple ID (safer, no 2FA prompts): App Store Connect → **Users and Access →
Integrations → App Store Connect API → +**. Store `ASC_KEY_ID`, `ASC_ISSUER_ID`,
and the downloaded `.p8` as `ASC_API_KEY_BASE64`.

> **How to get the `.p12` + password** (your earlier question): create/download an
> **Apple Distribution** certificate (Xcode does this automatically in A2, or make
> one in the Developer portal → Certificates), find it in **Keychain Access**,
> right-click → **Export**, choose `.p12`, and set a password *you* pick right
> there. That password is `IOS_DIST_CERT_PASSWORD`; the file is
> `IOS_DIST_CERT_P12_BASE64` after base64-encoding.

### C2. Workflow

A ready-to-fill template lives at **`.github/workflows/ios-adhoc.yml.disabled`**.
It is intentionally **not** active (renamed `.disabled`) so it never runs — and
never wastes macOS minutes — until you've created the secrets above and renamed
it to `ios-adhoc.yml`. It's `workflow_dispatch` only (manual **Run workflow**
button), for the same reason. The template documents each step inline.

The `.ipa` lands as a build **artifact** you download from the run — the iOS
equivalent of the `aurabridge-stage2-apk` artifact.

---

## Recommendation

1. Enrol in the Apple Developer Program (unavoidable).
2. Do **Path A** by hand — it's ~20 minutes and gets a real build onto a second
   iPhone today.
3. Move to **Path B (TestFlight)** when the tester list outgrows registered UDIDs.
4. Stand up **Path C** only if the manual archive becomes a chore.

Tell me which path you're taking and I'll walk you through the exact clicks (or,
for C, help you fill the workflow once the secrets exist).
