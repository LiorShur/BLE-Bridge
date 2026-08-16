/**
 * Audio cues — thin wrapper over the native `Sound` module
 * (android/.../ble/SoundModule.kt, ToneGenerator-based). Every call is a no-op if
 * the module is missing, so callers never need to guard.
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import { NativeModules } from 'react-native';

interface NativeSound {
  formation(): void;
  breakTone(): void;
  send(): void;
  receive(): void;
  delivered(): void;
}

const mod = NativeModules.Sound as NativeSound | undefined;

function safe(fn: (m: NativeSound) => void): void {
  try {
    if (mod) fn(mod);
  } catch {
    /* audio is best-effort */
  }
}

export const Sound = {
  formation: (): void => safe((m) => m.formation()),
  breakTone: (): void => safe((m) => m.breakTone()),
  send: (): void => safe((m) => m.send()),
  receive: (): void => safe((m) => m.receive()),
  /** Played on the *sender's* device when a peer confirms receipt. */
  delivered: (): void => safe((m) => m.delivered()),
};
