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
import { BRIDGE_SERVICE_UUID, PAYLOAD_CHAR_UUID, MESSAGE_CHAR_UUID } from './constants';

const RSSI_POLL_MS = 350;
const CONNECT_TIMEOUT_MS = 8000;
// After a failed connect, wait before retrying — growing with the attempt count.
// Android GATT-133 is often transient, but hammering connect (the scan delivers a
// sighting several times a second) reliably makes it WORSE, so we throttle hard.
const BACKOFF_STEP_MS = 3000;
const BACKOFF_MAX_MS = 20000;

interface Conn {
  deviceId: string;
  monitor: Subscription | null;
  disconnectSub: Subscription | null;
  rssiTimer: ReturnType<typeof setInterval> | null;
  lastRssi: number | null;
  lastBytes: Uint8Array | null;
  /** Message-characteristic notification subscription (GATT_MESSAGING_SPEC). */
  msgMonitor: Subscription | null;
  /** Negotiated ATT MTU; JS chunks outbound frames to `mtu − 3`. */
  mtu: number;
}

/** Default ATT MTU before negotiation (23 → 20 usable payload bytes). */
const DEFAULT_MTU = 23;
const TARGET_MTU = 517;

export class GattClient {
  private manager: BleManager;
  private conns = new Map<number, Conn>(); // by peerId (Android peers, id known upfront)
  private connecting = new Set<number>();
  // Per-peer failed-connect backoff: last attempt time + consecutive failures.
  private attempts = new Map<number, { lastAt: number; count: number }>();

  // Device-keyed connections for peers whose peerId isn't on the wire (iOS):
  // discovered by service UUID, peerId learned from the payload after connecting.
  private deviceConns = new Map<string, Conn>();
  private deviceConnecting = new Set<string>();
  private deviceAttempts = new Map<string, { lastAt: number; count: number }>();

  // Inbound message frames from any connected peer's message characteristic.
  private onFrame?: (deviceId: string, frameBase64: string) => void;
  // peerId → the deviceId we're connected to it on (learned from its payload).
  private devicePeers = new Map<number, string>();

  constructor(manager: BleManager) {
    this.manager = manager;
  }

  /** The deviceId we hold a GATT link to for this peer, or null if none. */
  deviceIdForPeer(peerId: number): string | null {
    const deviceId = this.devicePeers.get(peerId >>> 0);
    if (!deviceId) return null;
    // Only report it if the link is actually live.
    const live = this.deviceConns.has(deviceId) || [...this.conns.values()].some((c) => c.deviceId === deviceId);
    return live ? deviceId : null;
  }

  /** Register the sink for inbound message frames (GATT_MESSAGING_SPEC). */
  setMessageSink(cb: (deviceId: string, frameBase64: string) => void): void {
    this.onFrame = cb;
  }

  /**
   * After a connection is up, request a large MTU and subscribe to the message
   * characteristic's notifications. Both are best-effort — a peer without the
   * message characteristic (older build) simply never delivers frames.
   */
  private attachMessaging(device: Device, conn: Conn): void {
    device
      .requestMTU(TARGET_MTU)
      .then((d: Device) => {
        if (typeof d.mtu === 'number' && d.mtu > 0) conn.mtu = d.mtu;
      })
      .catch(() => {
        /* MTU negotiation unsupported/failed — keep the default */
      });
    try {
      conn.msgMonitor = device.monitorCharacteristicForService(
        BRIDGE_SERVICE_UUID,
        MESSAGE_CHAR_UUID,
        (err, char) => {
          if (err) return; // disconnect handler cleans up
          if (char?.value) this.onFrame?.(conn.deviceId, char.value);
        },
      );
    } catch {
      /* characteristic absent — no messaging with this peer */
    }
  }

  /**
   * Write one message frame (pre-chunked to the MTU) to a connected peer, and
   * resolve whether it was written. We use write-WITH-response deliberately: it is
   * ATT-flow-controlled, so a multi-frame message (a photo) can't overrun the
   * transmit buffer and silently drop frames the way write-without-response does.
   * A single-frame text is unaffected. Returns false on failure so the paced drain
   * can hold and retry rather than race ahead.
   */
  writeMessageFrame(deviceId: string, frameBase64: string): Promise<boolean> {
    return this.manager
      .writeCharacteristicWithResponseForDevice(deviceId, BRIDGE_SERVICE_UUID, MESSAGE_CHAR_UUID, frameBase64)
      .then(() => true)
      .catch(() => false); // ack/retransmit + the drain's backpressure cover a failed write
  }

  /** Negotiated MTU for a connected peer (by deviceId), or the default. */
  peerMtu(deviceId: string): number {
    for (const c of this.conns.values()) if (c.deviceId === deviceId) return c.mtu;
    const dc = this.deviceConns.get(deviceId);
    return dc?.mtu ?? DEFAULT_MTU;
  }

  /** Number of live GATT connections (for the debug HUD). */
  activeCount(): number {
    return this.conns.size + this.deviceConns.size;
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

    // Respect the failed-connect backoff so we don't storm the radio.
    const att = this.attempts.get(peerId);
    if (att) {
      const wait = Math.min(BACKOFF_STEP_MS * att.count, BACKOFF_MAX_MS);
      if (Date.now() - att.lastAt < wait) return;
    }
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
          msgMonitor: null,
          mtu: DEFAULT_MTU,
        };
        conn.disconnectSub = d.onDisconnected(() => this.drop(peerId));
        conn.monitor = d.monitorCharacteristicForService(
          BRIDGE_SERVICE_UUID,
          PAYLOAD_CHAR_UUID,
          (err, char) => {
            if (err) return; // disconnect handler will clean up
            if (char?.value) {
              conn.lastBytes = base64ToBytes(char.value);
              this.emitObs(conn, onObs);
            }
          },
        );
        conn.rssiTimer = setInterval(() => {
          d.readRSSI()
            .then((dd: Device) => {
              if (dd.rssi != null) conn.lastRssi = dd.rssi;
              this.emitObs(conn, onObs);
            })
            .catch(() => {
              /* transient; disconnect handler covers a real drop */
            });
        }, RSSI_POLL_MS);
        this.attachMessaging(d, conn);
        this.conns.set(peerId, conn);
        this.connecting.delete(peerId);
        this.attempts.delete(peerId); // success clears the backoff
      })
      .catch((err: Error) => {
        this.connecting.delete(peerId);
        const prev = this.attempts.get(peerId);
        this.attempts.set(peerId, { lastAt: Date.now(), count: (prev?.count ?? 0) + 1 });
        onError?.(err);
      });
  }

  /**
   * Connect to a device discovered by service UUID whose peerId is unknown until
   * we read its payload (an iPhone). Keyed by deviceId; the emitted observation
   * carries the peerId decoded from the characteristic. Same backoff discipline.
   */
  connectDevice(
    deviceId: string,
    onObs: (obs: ScanObservation) => void,
    onError?: (e: Error) => void,
  ): void {
    if (!deviceId) return;
    if (this.deviceConns.has(deviceId) || this.deviceConnecting.has(deviceId)) return;

    const att = this.deviceAttempts.get(deviceId);
    if (att) {
      const wait = Math.min(BACKOFF_STEP_MS * att.count, BACKOFF_MAX_MS);
      if (Date.now() - att.lastAt < wait) return;
    }
    this.deviceConnecting.add(deviceId);

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
          msgMonitor: null,
          mtu: DEFAULT_MTU,
        };
        conn.disconnectSub = d.onDisconnected(() => this.dropDevice(deviceId));
        conn.monitor = d.monitorCharacteristicForService(
          BRIDGE_SERVICE_UUID,
          PAYLOAD_CHAR_UUID,
          (err, char) => {
            if (err) return;
            if (char?.value) {
              conn.lastBytes = base64ToBytes(char.value);
              this.emitObs(conn, onObs);
            }
          },
        );
        conn.rssiTimer = setInterval(() => {
          d.readRSSI()
            .then((dd: Device) => {
              if (dd.rssi != null) conn.lastRssi = dd.rssi;
              this.emitObs(conn, onObs);
            })
            .catch(() => {
              /* transient */
            });
        }, RSSI_POLL_MS);
        this.attachMessaging(d, conn);
        this.deviceConns.set(deviceId, conn);
        this.deviceConnecting.delete(deviceId);
        this.deviceAttempts.delete(deviceId);
      })
      .catch((err: Error) => {
        this.deviceConnecting.delete(deviceId);
        const prev = this.deviceAttempts.get(deviceId);
        this.deviceAttempts.set(deviceId, { lastAt: Date.now(), count: (prev?.count ?? 0) + 1 });
        onError?.(err);
      });
  }

  private emitObs(conn: Conn, onObs: (obs: ScanObservation) => void): void {
    if (!conn.lastBytes || conn.lastRssi == null) return; // need both a payload and an RSSI
    const payload = decodePayload(conn.lastBytes);
    if (!payload) return;
    // Learn peerId↔deviceId so the messaging layer can route an outbound message
    // (addressed by peerId) to the right connection (addressed by deviceId).
    this.devicePeers.set(payload.peerId >>> 0, conn.deviceId);
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
    this.teardown(conn);
    this.conns.delete(peerId);
    this.attempts.delete(peerId); // a dropped-but-established peer may reconnect freely
  }

  private dropDevice(deviceId: string): void {
    const conn = this.deviceConns.get(deviceId);
    if (!conn) return;
    this.teardown(conn);
    this.deviceConns.delete(deviceId);
    this.deviceAttempts.delete(deviceId);
  }

  private teardown(conn: Conn): void {
    if (conn.rssiTimer) clearInterval(conn.rssiTimer);
    conn.monitor?.remove();
    conn.msgMonitor?.remove();
    conn.disconnectSub?.remove();
    this.manager.cancelDeviceConnection(conn.deviceId).catch(() => {
      /* already gone */
    });
  }

  /** Drop every connection. Does NOT destroy the shared BleManager. */
  stop(): void {
    for (const peerId of [...this.conns.keys()]) this.drop(peerId);
    for (const deviceId of [...this.deviceConns.keys()]) this.dropDevice(deviceId);
    this.connecting.clear();
    this.deviceConnecting.clear();
  }
}
