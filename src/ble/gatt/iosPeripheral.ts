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
import { NativeModules, NativeEventEmitter, type EmitterSubscription } from 'react-native';

interface NativeBlePeripheral {
  startPeripheral(payloadBase64: string): Promise<void>;
  updatePayload(payloadBase64: string): Promise<void>;
  stopPeripheral(): Promise<void>;
  getStatus(): Promise<{ running: boolean; subscribers: number }>;
  /** Notify a message frame to subscribed centrals; resolves false if queue full. */
  notifyMessage(frameBase64: string): Promise<boolean>;
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

/**
 * Notify one message frame (pre-chunked to the notify size) to subscribed centrals.
 * Resolves the native updateValue result: `false` means the iOS transmit queue was
 * full and the frame was NOT sent — the paced drain uses this to hold and retry
 * rather than lose the frame (this is what makes a multi-frame photo survive).
 * Resolves `true` when the module is absent (Android) so it never blocks the drain.
 */
export async function notifyIosMessage(frameBase64: string): Promise<boolean> {
  const m = mod();
  if (!m) return true; // not the iOS peripheral — nothing to send here, don't stall
  try {
    return await m.notifyMessage(frameBase64);
  } catch {
    return false; // treat an error like a full queue: hold and retry
  }
}

/**
 * The BlePeripheral event emitter, or null with a CLEAR diagnostic if the native
 * module is present but not an RCTEventEmitter — the tell-tale of a STALE iOS
 * build (BlePeripheral not recompiled with messaging). Beats RN's cryptic
 * "NativeEventEmitter … without the required addListener method" warning.
 */
function messageEmitter(): NativeEventEmitter | null {
  const raw = NativeModules.BlePeripheral as { addListener?: unknown; removeListeners?: unknown } | undefined;
  if (!raw) return null;
  if (typeof raw.addListener !== 'function' || typeof raw.removeListeners !== 'function') {
    // eslint-disable-next-line no-console
    console.warn(
      'BlePeripheral is not an event emitter — messaging is disabled. This is a STALE iOS build: ' +
        'clean DerivedData + Clean Build Folder and rebuild (docs/GATT_MESSAGING_SPEC.md).',
    );
    return null;
  }
  return new NativeEventEmitter(NativeModules.BlePeripheral);
}

/** A central wrote a message frame to us (iPhone peripheral side). */
export function onIosPeripheralMessage(cb: (frameBase64: string) => void): EmitterSubscription | null {
  return messageEmitter()?.addListener('BlePeripheral:message', (e: { data: string }) => cb(e.data)) ?? null;
}

/** A central subscribed; `mtu` is the max notify size — JS chunks frames to it. */
export function onIosPeripheralMtu(cb: (mtu: number) => void): EmitterSubscription | null {
  return messageEmitter()?.addListener('BlePeripheral:mtu', (e: { mtu: number }) => cb(e.mtu)) ?? null;
}
