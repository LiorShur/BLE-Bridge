/**
 * Build-stage feature flags.
 *
 * Stage 2 (current): AR camera bridge via Viro + native compass "face each
 * other" gate. Adds the @reactvision/react-viro dependency and the native
 * Heading module; App renders the ViroAR scene and uses the compass.
 *
 * Stage 1 (validated): Viro-free APK — BLE discovery + signal engine + 2D
 * on-screen bridge + HUD, multi-peer, proximity-only. Flip both flags off and
 * drop the Viro dep to rebuild it (BridgeView2D is retained for that path).
 */
export const AR_ENABLED = true;
export const HEADING_ENABLED = true;
