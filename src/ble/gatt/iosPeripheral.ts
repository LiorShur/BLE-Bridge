/**
 * Typed wrapper over the iOS-only native `BlePeripheral` module
 * (ios/AuraBridge/BlePeripheral.swift) — the iPhone's GATT peripheral for the
 * interop path (docs/GATT_SPEC.md §5, P-i2b). It advertises the Bridge service
 * UUID and serves the 24-byte payload as a read+notify characteristic, so an
 * Android central can discover and read the iPhone.
 *
 * Best-effort: every call is a no-op if the module is missing (e.g. before the
 * Swift file is added to the Xcode project, or on Android).
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import { NativeModules } from 'react-native';

interface NativeBlePeripheral {
  startPeripheral(payloadBase64: string): Promise<void>;
  updatePayload(payloadBase64: string): Promise<void>;
  stopPeripheral(): Promise<void>;
  getStatus(): Promise<{ running: boolean; subscribers: number }>;
}

function mod(): NativeBlePeripheral | undefined {
  return NativeModules.BlePeripheral as NativeBlePeripheral | undefined;
}

/** True when the native iOS peripheral module is present. */
export function iosPeripheralAvailable(): boolean {
  return mod() !== undefined;
}

export async function startIosPeripheral(payloadBase64: string): Promise<void> {
  try {
    await mod()?.startPeripheral(payloadBase64);
  } catch {
    /* best-effort */
  }
}

export async function updateIosPeripheralPayload(payloadBase64: string): Promise<void> {
  try {
    await mod()?.updatePayload(payloadBase64);
  } catch {
    /* best-effort */
  }
}

export async function stopIosPeripheral(): Promise<void> {
  try {
    await mod()?.stopPeripheral();
  } catch {
    /* best-effort */
  }
}

export async function iosPeripheralStatus(): Promise<{ running: boolean; subscribers: number }> {
  try {
    const s = await mod()?.getStatus();
    return s ?? { running: false, subscribers: 0 };
  } catch {
    return { running: false, subscribers: 0 };
  }
}
