/**
 * Typed wrapper over the native `BleGattServer` module
 * (android/.../ble/BleGattServerModule.kt) — the peripheral side of the interop
 * path (docs/GATT_SPEC.md). Hosts the Bridge service whose PAYLOAD characteristic
 * value is the 24-byte payload; centrals subscribe and receive a notify whenever
 * the payload changes.
 *
 * Every call is best-effort and a no-op when the module is missing, so callers on
 * the connectionless-only build never need to guard.
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import { NativeModules } from 'react-native';

interface NativeGattServer {
  startServer(payloadBase64: string): Promise<void>;
  updatePayload(payloadBase64: string): Promise<void>;
  stopServer(): Promise<void>;
  getStatus(): Promise<{ running: boolean; subscribers: number }>;
}

function mod(): NativeGattServer | undefined {
  return NativeModules.BleGattServer as NativeGattServer | undefined;
}

/** Start hosting the Bridge GATT service with the given initial payload. */
export async function startGattServer(payloadBase64: string): Promise<void> {
  try {
    await mod()?.startServer(payloadBase64);
  } catch {
    /* best-effort */
  }
}

/** Push a new payload to subscribed centrals (notify). */
export async function updateGattPayload(payloadBase64: string): Promise<void> {
  try {
    await mod()?.updatePayload(payloadBase64);
  } catch {
    /* best-effort */
  }
}

/** Tear the server down. */
export async function stopGattServer(): Promise<void> {
  try {
    await mod()?.stopServer();
  } catch {
    /* best-effort */
  }
}

export async function gattServerStatus(): Promise<{ running: boolean; subscribers: number }> {
  try {
    const s = await mod()?.getStatus();
    return s ?? { running: false, subscribers: 0 };
  } catch {
    return { running: false, subscribers: 0 };
  }
}
