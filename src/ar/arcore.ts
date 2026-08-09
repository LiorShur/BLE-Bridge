/**
 * ARCore availability probe (TASKS.md P0-6, CLAUDE.md §6 "fail loudly").
 *
 * ViroReact renders to ARCore natively; there is no first-class JS availability
 * API bundled, so this wraps the platform check. Today it returns a conservative
 * "assumed available on Android" result — replace with a real check
 * (`ArCoreApk.checkAvailability`, exposed via a tiny native method) before the
 * capability screen can honestly report it. The seam exists so the UI already
 * treats ARCore as a gate rather than an assumption.
 *
 * NOTE: depends on React Native; not testable off-device.
 */
import { Platform } from 'react-native';

export interface ArCoreReport {
  available: boolean;
  reason?: string;
}

export async function checkArCore(): Promise<ArCoreReport> {
  if (Platform.OS !== 'android') {
    return { available: false, reason: 'This PoC is Android-only.' };
  }
  // TODO(native): bridge ArCoreApk.checkAvailability() and surface INSTALLED /
  // SUPPORTED_NOT_INSTALLED / UNSUPPORTED_DEVICE_NOT_CAPABLE honestly.
  return { available: true };
}
