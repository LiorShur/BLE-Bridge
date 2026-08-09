/**
 * Build-stage feature flags.
 *
 * Stage 2 (current): camera-overlay bridge + native compass "face each other"
 * gate. ARCore/Viro was dropped because the target devices (Huawei P10/P30 Pro,
 * etc.) can't install Google Play Services for AR; the design renders the bridge
 * straight ahead with no world tracking (CLAUDE.md §3.2), so a live camera
 * preview + overlay is a faithful, hardware-independent realization. App renders
 * CameraBridge (react-native-vision-camera) and uses the compass.
 *
 * The Viro scene (src/ar/BridgeScene.tsx) is retained in-repo, unused, for any
 * future ARCore-capable device.
 *
 * Stage 1 (validated): BLE discovery + signal engine + 2D bridge + HUD, no
 * camera/compass.
 */
export const AR_ENABLED = true;
export const HEADING_ENABLED = true;
