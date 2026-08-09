# TASKS.md

Work through phases in order. **Each phase has an acceptance gate — do not start
the next phase until the gate passes on two physical devices.**

Task IDs are stable; reference them in commit messages.

---

## Phase 0 — Skeleton

Goal: a running app on two devices with permissions granted and a cube in AR.
No Bluetooth yet.

- [ ] **P0-1** Initialise React Native project (bare, or Expo with a dev build),
      TypeScript strict mode, `com.aurabridge` package ID.
- [ ] **P0-2** Install and configure `@reactvision/react-viro`. Confirm the
      Android build succeeds and the app launches.
- [ ] **P0-3** Render a `ViroARScene` containing a single spinning box anchored
      1.5 m in front of the camera. Verify tracking initialises on both devices.
- [ ] **P0-4** Add manifest permissions: `BLUETOOTH_SCAN` (with
      `android:usesPermissionFlags="neverForLocation"`), `BLUETOOTH_ADVERTISE`,
      `BLUETOOTH_CONNECT`, `CAMERA`.
- [ ] **P0-5** Runtime permission request flow on launch, with a clear
      explanatory screen if any are denied.
- [ ] **P0-6** Startup capability check screen reporting, per device:
      Bluetooth enabled · advertising supported
      (`isMultipleAdvertisementSupported`) · ARCore available · compass present.
      Show plainly on screen; do not hide it in logs.
- [ ] **P0-7** Zustand store scaffold with the `BondState` shape from
      `CLAUDE.md` §3.4, populated with stub values.

**Gate P0:** both devices launch, grant all permissions, report full capability,
and render the spinning cube. If either device reports advertising unsupported,
stop and source a different device — the entire project depends on it.

---

## Phase 1 — BLE, no AR

Goal: two phones reliably see each other's payloads. **This is the phase that
decides whether the project works.** No Viro code in this phase.

- [ ] **P1-1** Implement `src/ble/payload.ts` — `encodePayload()` /
      `decodePayload()` per `docs/PAYLOAD_SPEC.md`. Pure functions, big-endian.
- [ ] **P1-2** Unit tests for P1-1: round-trip fidelity, boundary values,
      `0xFFFF` heading sentinel, negative `txPower` (int8), version mismatch
      rejection, truncated-buffer rejection.
- [ ] **P1-3** Write the Kotlin advertiser module per
      `docs/BLE_ADVERTISER_MODULE.md` (`BleAdvertiserModule.kt`,
      `BleAdvertiserPackage.kt`), and register the package.
- [ ] **P1-4** TypeScript wrapper `src/ble/advertiser.ts` — typed promises,
      typed event emitter, mapped error codes.
- [ ] **P1-5** Generate a session `peerId` (random uint32) on first launch; hold
      it for the app session.
- [ ] **P1-6** Start advertising a static payload (fixed heading, fixed flags).
      Verify with a generic BLE scanner app (nRF Connect) that the manufacturer
      data `0xFFFF` appears with the expected bytes. **Do this before writing the
      scanner** — it isolates the failure surface.
- [ ] **P1-7** Implement `src/ble/scanner.ts` using `react-native-ble-plx`:
      start one long-lived scan in `SCAN_MODE_LOW_LATENCY`, discard results
      whose manufacturer data does not begin with the expected version byte.
      Never restart the scan in a tight loop (see `CLAUDE.md` §6).
- [ ] **P1-8** `useNearbyPeers()` hook: scan results → `PeerSnapshot[]`, keyed on
      payload `peerId`, **not** on the BLE device address.
- [ ] **P1-9** Debug HUD (`src/debug/DebugHUD.tsx`): per peer, show peerId, raw
      RSSI, sample rate (Hz), peer txPower, peer heading, flags, sequence
      counter, and time since last packet.
- [ ] **P1-10** Advertising lifecycle: stop on app background, restart on
      foreground. No leaked advertisers.

**Gate P1:** with both apps open, each device shows the other in the HUD within
3 seconds, sustains ≥ 2 packets/second at 2 m, and the peerId remains stable for
a continuous 20-minute session (this specifically proves the MAC randomisation
issue in `CLAUDE.md` §3.3 is handled). Walk to 10 m and back; the peer should
disappear and reappear without the app getting stuck.

---

## Phase 2 — Signal conditioning

Goal: stable, meaningful numbers. Still no AR.

- [ ] **P2-1** `src/signal/rssi.ts` — EMA smoothing (α = 0.2), seeded from the
      first sample. Unit tested.
- [ ] **P2-2** Calibrate `txPower`: measure RSSI at exactly 1 m for each test
      device, average over 30 seconds. Record the per-model values in
      `docs/CALIBRATION.md` and use the local device's value in the outgoing
      payload.
- [ ] **P2-3** Distance model per `CLAUDE.md` §4.2, using the **peer's**
      advertised txPower. Unit tested.
- [ ] **P2-4** Compass heading source with accuracy value; feed into the
      outgoing payload. Emit `0xFFFF` when unavailable.
- [ ] **P2-5** Payload republish policy: update only when heading has changed
      > 5° or 1000 ms have elapsed, whichever first. Increment the sequence
      counter on each republish. (Republishing requires an advertiser
      stop/start — do not do it at sensor rate.)
- [ ] **P2-6** `src/signal/alignment.ts` per `CLAUDE.md` §4.3, including the
      low-accuracy fallback to `alignment = 1`. Unit tested.
- [ ] **P2-7** `src/signal/bond.ts` — hysteresis state machine (form > 0.60,
      break < 0.35, 400 ms dwell) plus staleness decay. Unit tested with a
      simulated time source.
- [ ] **P2-8** Extend the HUD: smoothed RSSI, estimated distance, proximity,
      alignment, raw product, final strength, bonded flag — plus live sliders
      for α, n, `D_NEAR`, `D_FAR`, `TOLERANCE` so constants can be tuned on the
      device rather than through rebuilds.

**Gate P2:** standing still at 2 m, estimated distance varies by less than
±0.5 m over 30 seconds. Turning to face away drops `alignment` below 0.2 within
1.5 seconds and turning back restores it. `bonded` does not flicker when
hovering at the threshold. Both devices agree on `bonded` within ~500 ms of each
other.

---

## Phase 3 — The effect

Only now does Viro come back.

- [ ] **P3-1** `BridgeScene.tsx`: `ViroARScene` reading `BondState` from the
      store. Accept a `peerPosition` prop, hardcoded for now to 2 m straight
      ahead along −Z (this is the seam for the future Cloud Anchors / UWB
      upgrade — do not skip it).
- [ ] **P3-2** Base bridge geometry: a simple arc or beam toward `peerPosition`.
      Keep the mesh trivial; the magic comes from particles and easing, not
      polygons.
- [ ] **P3-3** Particle stream along the bridge path using Viro's particle
      system. Bind emission rate and velocity to `strength`.
- [ ] **P3-4** Bind material/shader parameters to state: colour temperature and
      emissive intensity to `proximity`, opacity to `alignment`.
- [ ] **P3-5** Ambient pre-bond state — a faint directional shimmer when a peer
      is detected but not yet bonded, so the user knows to look around. Without
      this the app feels dead until the exact moment of success.
- [ ] **P3-6** Peer aura colour from the payload hue byte, so the two users see
      distinguishable, personal colours.
- [ ] **P3-7** Smooth all bindings — no raw state values driving visuals
      directly. Ease every parameter over 200–400 ms.

**Gate P3:** two people can walk toward each other, turn to face, and both see a
bridge form. It does not strobe. It does not vanish when someone shifts their
grip.

---

## Phase 4 — The moment

The formation event is 10% of the code and 80% of the reaction. Budget real time.

- [ ] **P4-1** Formation sequence: a distinct burst/snap animation on the
      `bonded` transition, not just a fade-in.
- [ ] **P4-2** Haptics on formation, on both devices.
- [ ] **P4-3** Audio cue — a rising tone on formation, a soft fall on break.
- [ ] **P4-4** Dissolution animation on break, distinct from the staleness decay.
- [ ] **P4-5** Onboarding screen: "find someone with the app, stand close, face
      each other." Two sentences, no tutorial.
- [ ] **P4-6** Debug HUD behind a hidden gesture (e.g. three-finger long press)
      rather than removed.
- [ ] **P4-7** Failure states with human-readable copy: Bluetooth off,
      permission denied, advertising unsupported, ARCore missing.
- [ ] **P4-8** Record a demo video on two devices. If it doesn't read well on
      video, it doesn't read well in person.

**Gate P4:** hand both phones to two people who have never seen it, say nothing
beyond the onboarding text, and watch. If they figure it out and react, done.

---

## Deferred — do not build without explicit instruction

- ARCore Cloud Anchors for a genuinely shared coordinate frame (replaces the
  hardcoded `peerPosition` from P3-1). Note this costs a network round-trip and
  several seconds of camera sweeping from both users — it is not strictly better
  than the stylised version for a walking-around-outdoors experience.
- UWB ranging via the Android 16 Ranging module for real distance + angle of
  arrival. Hardware-limited to Pro-tier Pixels and Galaxy Ultras; treat as
  progressive enhancement, never a baseline requirement.
- GATT connection for a richer two-way channel.
- More than two simultaneous peers.
- iOS support. Note that iOS backgrounded advertising is heavily restricted and
  iOS omits the local name entirely, so cross-platform discovery requires
  scanning for a specific 128-bit service UUID.
