/**
 * GATT **central** for the interop path (docs/GATT_SPEC.md §4).
 *
 * Discovery is NOT a second scan: the connectionless scanner already sees every
 * peer (they advertise manufacturer data AND the service UUID in the scan
 * response), so `useBondEngine` hands us the ble-plx deviceId of a peer we should
 * dial (role tie-break: lower peerId is central). We connect, subscribe to the
 * payload characteristic, poll RSSI, and emit the same {@link ScanObservation}
 * the connectionless path produces — so the pure signal engine treats a GATT peer
 * exactly like an advertised one.
 *
 * Keyed by peerId (stable identity), not deviceId (the MAC rotates ~every 15 min);
 * a new deviceId for a known peer triggers a reconnect.
 *
 * NOTE: depends on React Native + native BLE; not part of the pure-logic suite.
 */
import { BleManager, type Device, type Subscription } from 'react-native-ble-plx';
import { base64ToBytes } from '../base64';
import { decodePayload, headingToDegrees } from '../payload';
import type { ScanObservation } from '../scanner';
import { BRIDGE_SERVICE_UUID, PAYLOAD_CHAR_UUID } from './constants';

const RSSI_POLL_MS = 350;
const CONNECT_TIMEOUT_MS = 8000;

interface Conn {
  deviceId: string;
  monitor: Subscription | null;
  disconnectSub: Subscription | null;
  rssiTimer: ReturnType<typeof setInterval> | null;
  lastRssi: number | null;
  lastBytes: Uint8Array | null;
}

export class GattClient {
  private manager: BleManager;
  private conns = new Map<number, Conn>(); // by peerId
  private connecting = new Set<number>();

  constructor(manager: BleManager) {
    this.manager = manager;
  }

  /** Number of live GATT connections (for the debug HUD). */
  activeCount(): number {
    return this.conns.size;
  }

  /** True if we currently hold a GATT link to this peer. */
  isConnected(peerId: number): boolean {
    return this.conns.has(peerId);
  }

  /**
   * Ensure a GATT connection to `peerId` (found at `deviceId`). Idempotent: a
   * no-op if already connected to the same device; reconnects if the peer's
   * deviceId changed; ignored while a connect is already in flight.
   */
  ensureConnected(
    deviceId: string,
    peerId: number,
    onObs: (obs: ScanObservation) => void,
    onError?: (e: Error) => void,
  ): void {
    if (!deviceId) return;
    const existing = this.conns.get(peerId);
    if (existing) {
      if (existing.deviceId === deviceId) return; // already good
      this.drop(peerId); // MAC rotated — reconnect to the new address
    }
    if (this.connecting.has(peerId)) return;
    this.connecting.add(peerId);

    this.manager
      .connectToDevice(deviceId, { timeout: CONNECT_TIMEOUT_MS })
      .then((d: Device) => d.discoverAllServicesAndCharacteristics())
      .then((d: Device) => {
        const conn: Conn = {
          deviceId,
          monitor: null,
          disconnectSub: null,
          rssiTimer: null,
          lastRssi: null,
          lastBytes: null,
        };
        conn.disconnectSub = d.onDisconnected(() => this.drop(peerId));
        conn.monitor = d.monitorCharacteristicForService(
          BRIDGE_SERVICE_UUID,
          PAYLOAD_CHAR_UUID,
          (err, char) => {
            if (err) return; // disconnect handler will clean up
            if (char?.value) {
              conn.lastBytes = base64ToBytes(char.value);
              this.emit(peerId, conn, onObs);
            }
          },
        );
        conn.rssiTimer = setInterval(() => {
          d.readRSSI()
            .then((dd: Device) => {
              if (dd.rssi != null) conn.lastRssi = dd.rssi;
              this.emit(peerId, conn, onObs);
            })
            .catch(() => {
              /* transient; disconnect handler covers a real drop */
            });
        }, RSSI_POLL_MS);
        this.conns.set(peerId, conn);
        this.connecting.delete(peerId);
      })
      .catch((err: Error) => {
        this.connecting.delete(peerId);
        onError?.(err);
      });
  }

  private emit(peerId: number, conn: Conn, onObs: (obs: ScanObservation) => void): void {
    if (!conn.lastBytes || conn.lastRssi == null) return; // need both a payload and an RSSI
    const payload = decodePayload(conn.lastBytes);
    if (!payload) return;
    onObs({
      payload,
      headingDeg: headingToDegrees(payload.headingDecideg),
      rssi: conn.lastRssi,
      timestamp: Date.now(),
      deviceId: conn.deviceId,
    });
  }

  private drop(peerId: number): void {
    const conn = this.conns.get(peerId);
    if (!conn) return;
    if (conn.rssiTimer) clearInterval(conn.rssiTimer);
    conn.monitor?.remove();
    conn.disconnectSub?.remove();
    this.conns.delete(peerId);
    this.manager.cancelDeviceConnection(conn.deviceId).catch(() => {
      /* already gone */
    });
  }

  /** Drop every connection. Does NOT destroy the shared BleManager. */
  stop(): void {
    for (const peerId of [...this.conns.keys()]) this.drop(peerId);
    this.connecting.clear();
  }
}
