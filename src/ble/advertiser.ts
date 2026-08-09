/**
 * Typed wrapper over the native `BleAdvertiser` module
 * (android/.../ble/BleAdvertiserModule.kt, spec docs/BLE_ADVERTISER_MODULE.md).
 *
 * Turns the bridge's stringly-typed surface into typed promises and a typed
 * event stream, and makes `start()` resolve only after the native
 * `onStartSuccess` event — so callers never optimistically believe advertising
 * began when it actually failed.
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite. See
 * src/README.md for what is and isn't verifiable off-device.
 */
import { NativeEventEmitter, NativeModules } from 'react-native';

export type AdvertiseErrorCode =
  | 'DATA_TOO_LARGE'
  | 'TOO_MANY_ADVERTISERS'
  | 'ALREADY_STARTED'
  | 'INTERNAL_ERROR'
  | 'FEATURE_UNSUPPORTED'
  | 'BLUETOOTH_UNAVAILABLE'
  | 'BLUETOOTH_DISABLED'
  | 'PERMISSION_DENIED'
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_BASE64'
  | 'START_TIMEOUT';

export interface SupportReport {
  supported: boolean;
  bluetoothPresent: boolean;
  bluetoothEnabled: boolean;
  advertisingSupported: boolean;
  reason?: string;
}

export interface AdvertiserStatus {
  advertising: boolean;
  lastError: string | null;
}

interface NativeBleAdvertiser {
  isSupported(): Promise<SupportReport>;
  startAdvertising(payloadBase64: string): Promise<void>;
  updatePayload(payloadBase64: string): Promise<void>;
  stopAdvertising(): Promise<void>;
  getStatus(): Promise<AdvertiserStatus>;
}

export class AdvertiseError extends Error {
  constructor(
    public readonly code: AdvertiseErrorCode | string,
    message: string,
  ) {
    super(message);
    this.name = 'AdvertiseError';
  }
}

const EVENT_STARTED = 'BleAdvertiser:started';
const EVENT_FAILED = 'BleAdvertiser:failed';
const EVENT_STOPPED = 'BleAdvertiser:stopped';

const START_TIMEOUT_MS = 4000;

function nativeModule(): NativeBleAdvertiser {
  const mod = NativeModules.BleAdvertiser as NativeBleAdvertiser | undefined;
  if (!mod) {
    throw new AdvertiseError(
      'INTERNAL_ERROR',
      'Native BleAdvertiser module is not linked. Did you register BleAdvertiserPackage? See BUILD.md.',
    );
  }
  return mod;
}

let emitter: NativeEventEmitter | null = null;
function getEmitter(): NativeEventEmitter {
  if (!emitter) emitter = new NativeEventEmitter(NativeModules.BleAdvertiser);
  return emitter;
}

export type StoppedReason = 'user' | 'lifecycle';

/** Subscribe to advertiser lifecycle events. Returns an unsubscribe function. */
export function onAdvertiserEvent(handlers: {
  started?: () => void;
  failed?: (e: { code: string; message: string }) => void;
  stopped?: (e: { reason: StoppedReason }) => void;
}): () => void {
  const e = getEmitter();
  const subs = [
    handlers.started && e.addListener(EVENT_STARTED, handlers.started),
    handlers.failed && e.addListener(EVENT_FAILED, handlers.failed),
    handlers.stopped && e.addListener(EVENT_STOPPED, handlers.stopped),
  ].filter(Boolean) as Array<{ remove: () => void }>;
  return () => subs.forEach((s) => s.remove());
}

/** Startup capability probe (task P0-6). Never throws. */
export function isSupported(): Promise<SupportReport> {
  return nativeModule().isSupported();
}

/**
 * Begin advertising `payloadBase64`. Resolves only once the native layer emits
 * `started`; rejects on `failed` or after {@link START_TIMEOUT_MS}.
 */
export function startAdvertising(payloadBase64: string): Promise<void> {
  const settled = waitForStart();
  return nativeModule()
    .startAdvertising(payloadBase64)
    .then(() => settled)
    .catch((err: unknown) => {
      settled.cancel();
      throw toAdvertiseError(err);
    });
}

/** Republish a new payload (native stop→start). Same success semantics as start. */
export function updatePayload(payloadBase64: string): Promise<void> {
  return nativeModule()
    .updatePayload(payloadBase64)
    .catch((err: unknown) => {
      throw toAdvertiseError(err);
    });
}

/** Stop advertising. Idempotent. */
export function stopAdvertising(): Promise<void> {
  return nativeModule()
    .stopAdvertising()
    .catch((err: unknown) => {
      throw toAdvertiseError(err);
    });
}

export function getStatus(): Promise<AdvertiserStatus> {
  return nativeModule().getStatus();
}

interface CancelablePromise extends Promise<void> {
  cancel(): void;
}

/** Race the next `started` event against the next `failed` event and a timeout. */
function waitForStart(): CancelablePromise {
  const e = getEmitter();
  let done = false;
  let onStarted: { remove: () => void } | null = null;
  let onFailed: { remove: () => void } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = (): void => {
    onStarted?.remove();
    onFailed?.remove();
    if (timer) clearTimeout(timer);
  };

  const p = new Promise<void>((resolve, reject) => {
    onStarted = e.addListener(EVENT_STARTED, () => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    });
    onFailed = e.addListener(EVENT_FAILED, (payload: { code: string; message: string }) => {
      if (done) return;
      done = true;
      cleanup();
      reject(new AdvertiseError(payload.code, payload.message));
    });
    timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new AdvertiseError('START_TIMEOUT', 'Advertiser did not report success in time.'));
    }, START_TIMEOUT_MS);
  }) as CancelablePromise;

  p.cancel = (): void => {
    if (done) return;
    done = true;
    cleanup();
  };
  return p;
}

function toAdvertiseError(err: unknown): AdvertiseError {
  if (err instanceof AdvertiseError) return err;
  const anyErr = err as { code?: string; message?: string } | undefined;
  return new AdvertiseError(anyErr?.code ?? 'INTERNAL_ERROR', anyErr?.message ?? 'Advertiser error.');
}
