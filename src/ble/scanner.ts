/**
 * BLE scan loop over `react-native-ble-plx`.
 *
 * ble-plx can only filter by service UUID, not manufacturer data, so Phase 1
 * scans unfiltered and discards non-matching results in JS (CLAUDE.md §6). One
 * long-lived scan is started in low-latency mode and NEVER restarted in a tight
 * loop — Android blocks >5 startScan calls / 30 s.
 *
 * Every accepted result is decoded through the pure, tested codec and keyed on
 * the payload `peerId`, never the BLE device address (which randomises — §3.3).
 *
 * NOTE: depends on React Native + native BLE; not in the pure-logic test suite.
 */
import { BleManager, ScanMode, State, type Device, type Subscription } from 'react-native-ble-plx';
import { extractPayloadBytes } from './manufacturer';
import { decodePayload, headingToDegrees, type DecodedPayload } from './payload';
import { BRIDGE_SERVICE_UUID } from './gatt/constants';

/**
 * A peer that advertises the Bridge SERVICE UUID but carries no manufacturer
 * payload — i.e. an iOS device (iOS can't advertise manufacturer data). The GATT
 * interop path connects to it to read the payload characteristic.
 */
export type GattCandidateObserver = (deviceId: string, rssi: number) => void;

/** A decoded, radio-stamped view of one peer advertisement. */
export interface ScanObservation {
  payload: DecodedPayload;
  /** Peer heading in DEGREES (converted from wire decidegrees), or null. */
  headingDeg: number | null;
  /** Raw RSSI in dBm at this observation. */
  rssi: number;
  /** Monotonic-ish receive timestamp (ms). */
  timestamp: number;
  /**
   * ble-plx device id (MAC on Android) for THIS sighting. Randomises ~every
   * 15 min, so it is NEVER identity (that's payload.peerId) — but it is the
   * handle the GATT interop path needs to connect. Empty string if unavailable.
   */
  deviceId: string;
}

export type ScanObserver = (obs: ScanObservation) => void;

/** True if a scan result advertises the Bridge service UUID (case-insensitive). */
function advertisesBridgeService(device: Device): boolean {
  const uuids = device.serviceUUIDs;
  if (!uuids) return false;
  return uuids.some((u) => u.toLowerCase() === BRIDGE_SERVICE_UUID);
}

export class BleScanner {
  private manager: BleManager;
  private scanning = false;
  private scanActive = false;
  private stateSub: Subscription | null = null;

  constructor(manager?: BleManager) {
    this.manager = manager ?? new BleManager();
  }

  /**
   * Start the single long-lived scan. Safe to call when already scanning (no-op).
   *
   * Waits for the adapter to reach {@link State.PoweredOn} before scanning. iOS
   * starts CoreBluetooth in `Unknown` and startDeviceScan errors with
   * "BluetoothLE is in unknown state" if called too early; this also correctly
   * surfaces BT-off / unauthorized instead of silently failing.
   *
   * @param onObservation called for every accepted, decoded peer advertisement
   * @param onError       called on scan errors (permission, BT off, etc.)
   * @param now           injectable clock for testing
   */
  start(
    onObservation: ScanObserver,
    onError?: (error: Error) => void,
    onGattCandidate?: GattCandidateObserver,
    now: () => number = Date.now,
  ): void {
    if (this.scanning) return;
    this.scanning = true;

    // emitCurrentState=true fires immediately with the current state, then on
    // changes — so if BLE is already on we scan at once, else we wait for it.
    this.stateSub = this.manager.onStateChange((state) => {
      if (state === State.PoweredOn) {
        this.beginScan(onObservation, onError, onGattCandidate, now);
      } else if (
        state === State.PoweredOff ||
        state === State.Unauthorized ||
        state === State.Unsupported
      ) {
        this.scanActive = false;
        onError?.(new Error(`Bluetooth ${state}`));
      }
      // Unknown / Resetting → keep waiting for PoweredOn.
    }, true);
  }

  private beginScan(
    onObservation: ScanObserver,
    onError: ((error: Error) => void) | undefined,
    onGattCandidate: GattCandidateObserver | undefined,
    now: () => number,
  ): void {
    if (this.scanActive) return; // already scanning (state can re-emit PoweredOn)
    this.scanActive = true;
    this.manager.startDeviceScan(
      null, // no UUID filter — we filter on manufacturer data in JS
      { allowDuplicates: true, scanMode: ScanMode.LowLatency },
      (error, device: Device | null) => {
        if (error) {
          this.scanActive = false;
          onError?.(error);
          return;
        }
        if (!device) return;
        const obs = this.toObservation(device, now());
        if (obs) {
          onObservation(obs);
          return;
        }
        // No manufacturer payload — but if it advertises the Bridge service UUID
        // it's a GATT peer (an iPhone) to connect to and read over GATT.
        if (onGattCandidate && device.id && device.rssi != null && advertisesBridgeService(device)) {
          onGattCandidate(device.id, device.rssi);
        }
      },
    );
  }

  private toObservation(device: Device, timestamp: number): ScanObservation | null {
    const payloadBytes = extractPayloadBytes(device.manufacturerData);
    if (!payloadBytes) return null;
    const payload = decodePayload(payloadBytes);
    if (!payload) return null; // codec rejected per PAYLOAD_SPEC §6
    if (device.rssi === null || device.rssi === undefined) return null;
    return {
      payload,
      headingDeg: headingToDegrees(payload.headingDecideg),
      rssi: device.rssi,
      timestamp,
      deviceId: device.id ?? '',
    };
  }

  stop(): void {
    if (!this.scanning) return;
    this.stateSub?.remove();
    this.stateSub = null;
    if (this.scanActive) this.manager.stopDeviceScan();
    this.scanActive = false;
    this.scanning = false;
  }

  isScanning(): boolean {
    return this.scanning;
  }

  destroy(): void {
    this.stop();
    this.manager.destroy();
  }
}
