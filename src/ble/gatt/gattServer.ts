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
import { NativeModules, NativeEventEmitter, type EmitterSubscription } from 'react-native';

interface NativeGattServer {
  startServer(payloadBase64: string): Promise<void>;
  updatePayload(payloadBase64: string): Promise<void>;
  stopServer(): Promise<void>;
  getStatus(): Promise<{ running: boolean; subscribers: number }>;
  /** Notify a message frame to subscribed centrals (GATT_MESSAGING_SPEC). */
  notifyMessage(frameBase64: string): Promise<void>;
  addListener(event: string): void;
  removeListeners(count: number): void;
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

/** Notify one message frame (pre-chunked to the MTU) to subscribed centrals. */
export async function notifyGattMessage(frameBase64: string): Promise<void> {
  try {
    await mod()?.notifyMessage(frameBase64);
  } catch {
    /* best-effort — the ack/retransmit layer covers a dropped notify */
  }
}

/** A central wrote a message frame to us (peripheral side). `device` is its address. */
export function onGattServerMessage(cb: (device: string, frameBase64: string) => void): EmitterSubscription | null {
  const m = mod();
  if (!m) return null;
  const emitter = new NativeEventEmitter(NativeModules.BleGattServer);
  return emitter.addListener('BleGattServer:message', (e: { device: string; data: string }) =>
    cb(e.device, e.data),
  );
}

/** A central negotiated an MTU — JS chunks outbound frames to it (minus 3). */
export function onGattServerMtu(cb: (device: string, mtu: number) => void): EmitterSubscription | null {
  const m = mod();
  if (!m) return null;
  const emitter = new NativeEventEmitter(NativeModules.BleGattServer);
  return emitter.addListener('BleGattServer:mtu', (e: { device: string; mtu: number }) => cb(e.device, e.mtu));
}
