/**
 * Build-stage feature flags.
 *
 * Stage 1 (this build): reliable, Viro-free APK. BLE discovery + signal engine +
 * a 2D on-screen bridge visualization + HUD, multi-peer. No camera/AR, and no
 * compass dependency — heading is absent, so alignment falls back to 1 and bonds
 * form on proximity (CLAUDE.md §4.3). This is the fast, buildable milestone that
 * proves discovery on real phones.
 *
 * Stage 2: flip AR_ENABLED and HEADING_ENABLED on, add the Viro + compass deps,
 * and the app swaps the 2D view for the ViroAR bridge and the real "face each
 * other" gate. See BUILD.md.
 */
export const AR_ENABLED = false;
export const HEADING_ENABLED = false;
