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
import { BleManager, ScanMode, type Device } from 'react-native-ble-plx';
import { extractPayloadBytes } from './manufacturer';
import { decodePayload, headingToDegrees, type DecodedPayload } from './payload';

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

export class BleScanner {
  private manager: BleManager;
  private scanning = false;

  constructor(manager?: BleManager) {
    this.manager = manager ?? new BleManager();
  }

  /**
   * Start the single long-lived scan. Safe to call when already scanning (no-op).
   * @param onObservation called for every accepted, decoded peer advertisement
   * @param onError       called on scan errors (permission, BT off, etc.)
   * @param now           injectable clock for testing
   */
  start(
    onObservation: ScanObserver,
    onError?: (error: Error) => void,
    now: () => number = Date.now,
  ): void {
    if (this.scanning) return;
    this.scanning = true;

    this.manager.startDeviceScan(
      null, // no UUID filter — we filter on manufacturer data in JS
      { allowDuplicates: true, scanMode: ScanMode.LowLatency },
      (error, device: Device | null) => {
        if (error) {
          this.scanning = false;
          onError?.(error);
          return;
        }
        if (!device) return;
        const obs = this.toObservation(device, now());
        if (obs) onObservation(obs);
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
    this.manager.stopDeviceScan();
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
