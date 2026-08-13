/**
 * Zustand store — the single source of shared UI state (CLAUDE.md §5).
 *
 * Holds the local device identity/heading, the tunable signal constants exposed
 * to the debug HUD, the derived primary {@link BondState} the AR scene reads, and
 * per-peer debug rows. The signal engine writes; the AR scene and HUD read.
 *
 * NOTE: depends on `zustand`; not part of the pure-logic test suite.
 */
import { create } from 'zustand';
import type { BondState } from '../signal/bond';
import type { PeerDebugRow } from '../signal/engine';
import type { SupportReport } from '../ble/advertiser';
import { getSessionPeerId } from '../ble/identity';
import { DEFAULT_ALPHA, DEFAULT_PATH_LOSS_N, D_NEAR, D_FAR } from '../signal/rssi';
import { DEFAULT_TOLERANCE } from '../signal/alignment';
import { DEFAULT_BOND_CONFIG } from '../signal/bond';
import { DEFAULT_TX_POWER } from '../calibration';
import { DEFAULT_CATALOG_ID } from '../discovery/interests';

/** On-device tunable constants (HUD sliders, TASKS.md P2-8). */
export interface Tunables {
  alpha: number;
  pathLossN: number;
  dNear: number;
  dFar: number;
  toleranceDeg: number;
  formThreshold: number;
  breakThreshold: number;
  /** Alignment floor (0..1): proximity-led bonding, facing is a bonus. */
  alignFloor: number;
  /** Staleness window (ms) before the bridge starts fading. */
  staleMs: number;
  /** Fade duration (ms) once stale. */
  decayMs: number;
  /** Silence (ms) before the peer is dropped entirely. */
  removeMs: number;
}

export const DEFAULT_TUNABLES: Tunables = {
  alpha: DEFAULT_ALPHA,
  pathLossN: DEFAULT_PATH_LOSS_N,
  dNear: D_NEAR,
  dFar: D_FAR,
  toleranceDeg: DEFAULT_TOLERANCE,
  // Looser than the spec's 0.60/0.35 so bonding happens at a comfortable ~1–2 m
  // and survives movement instead of only at a few cm (field feedback).
  formThreshold: 0.5,
  breakThreshold: 0.3,
  // Proximity-led: a noisy/averted compass can't zero the bond; facing adds up
  // to the remaining 50%.
  alignFloor: 0.5,
  // Real-world tolerant staleness (looser than the spec's 2/0.8/5 s) so brief
  // radio gaps and duplicate-suppressing scanners don't collapse the bridge.
  staleMs: 4000,
  decayMs: 1500,
  removeMs: 10000,
};

export type { PeerDebugRow } from '../signal/engine';

const EMPTY_BOND: BondState = {
  proximity: 0,
  alignment: 0,
  strength: 0,
  bonded: false,
  peer: null,
};

/** A reaction this device is currently broadcasting toward a peer. */
export interface OutgoingReaction {
  targetPeerId: number;
  reactionId: number;
  nonce: number;
  sentAt: number;
}

/** A reaction received from a peer, awaiting a brief on-screen animation. */
export interface IncomingReaction {
  key: number;
  fromPeerId: number;
  reactionId: number;
  at: number;
}

/** A delivery ack this device is broadcasting back to a reaction's sender. */
export interface OutgoingAck {
  targetPeerId: number;
  nonce: number;
  sentAt: number;
}

/** Cached profile lookup for a peer (name/photo/interests fetched on bond). */
export interface ProfileEntry {
  status: 'loading' | 'loaded' | 'missing';
  name?: string;
  photoURL?: string | null;
  /** Discovery interest tag ids, if the peer published any. */
  interests?: string[];
  /** Optional one-line headline. */
  headline?: string;
  /** Where this entry came from — a peer-supplied GATT profile is authoritative. */
  source?: 'gatt' | 'firebase';
  /** When this lookup was last attempted (ms), so 'missing' can be retried. */
  triedAt?: number;
}

// Visibility semantics live in a pure, tested module; re-exported here so callers
// can keep importing them from the store alongside the state they gate.
export { isBroadcasting, isBrowsing, showsNudges } from '../discovery/visibility';
export type { Visibility } from '../discovery/visibility';
import type { Visibility } from '../discovery/visibility';

/** One line in a peer chat (GATT messaging channel, GATT_MESSAGING_SPEC). */
export interface ChatMessage {
  key: number;
  from: 'me' | 'them';
  text: string;
  at: number;
}

/** One ranked person in the "someone nearby you should meet" list (DISCOVERY_SPEC). */
export interface NearbyPerson {
  peerId: number;
  name: string | null;
  photoURL: string | null;
  headline: string | null;
  /** Shared interest tag ids, in my order. */
  shared: string[];
  /** Number of shared tags. */
  score: number;
  /** 0..1 proximity from the bond engine. */
  proximity: number;
  /** True if strong enough to nudge (score ≥ threshold). */
  strong: boolean;
}

export interface AppState {
  capability: SupportReport | null;
  localPeerId: number;
  localTxPower: number;
  localHeadingDeg: number | null;
  localHeadingAccuracy: number;
  hue: number;
  tunables: Tunables;
  /** Primary (strongest) peer projection. */
  bond: BondState;
  /** All active peers, strongest first — the multi-peer view the UI renders. */
  bonds: BondState[];
  peerRows: PeerDebugRow[];
  /** Whether this device is currently advertising, and last advertiser error. */
  advertising: boolean;
  advertiserError: string | null;
  /** Last BLE scan error (e.g. location services disabled), cleared on results. */
  scanError: string | null;
  /** Reaction currently being broadcast (null = none). */
  outgoingReaction: OutgoingReaction | null;
  /** Delivery ack currently being broadcast back to a sender (null = none). */
  outgoingAck: OutgoingAck | null;
  /** Nonces we've recently sent, to match an incoming ack → "delivered". */
  recentSentNonces: number[];
  /** Recently received reactions to animate. */
  incomingReactions: IncomingReaction[];
  /** Interop (GATT) path on/off — a debug toggle (docs/GATT_SPEC.md). */
  gattEnabled: boolean;
  /**
   * Proximity-only mode: when true the bond forms on closeness alone and the
   * "turn to face each other" facing gate is disabled (alignFloor forced to 1).
   * Default ON for the testing phase; flip off to require mutual facing (§3.2).
   */
  proximityMode: boolean;
  /** Transport the last observation for each peer arrived over. */
  peerTransports: Record<number, 'adv' | 'gatt'>;
  /** GATT server/central status for the HUD. */
  gattStatus: { serverRunning: boolean; subscribers: number; connections: number };
  /** Last GATT connection error, for diagnosing the interop path. */
  gattError: string | null;
  /** Peer whose enlarged profile card is open (tap a beam chip), or null. */
  expandedPeerId: number | null;
  /** Peer profiles fetched on bond, keyed by peerId. */
  profiles: Record<number, ProfileEntry>;
  /** The local user's own display name (null = not set yet). */
  myName: string | null;
  /** The local user's own photo URL (null = none). */
  myPhotoURL: string | null;
  /** The local user's own discovery interest tag ids. */
  myInterests: string[];
  /** The local user's primary interest (its bucket rides the wire); null = none. */
  myPrimaryInterest: string | null;
  /** The local user's own one-line discovery headline (null = none). */
  myHeadline: string | null;
  /** Active interest catalog id (per-event customization; generic by default). */
  activeCatalogId: string;
  /**
   * Discovery visibility mode (off/open/curious/ghost — see {@link Visibility}).
   * OFF by default. Replaces the old boolean; the wire still carries only the
   * single LOOKING_TO_MEET bit, set when the mode {@link isBroadcasting}.
   */
  visibility: Visibility;
  /** Ranked nearby people who are also looking (written by useDiscovery). */
  nearby: NearbyPerson[];
  /** Whether the "People nearby" sheet is open. */
  nearbyOpen: boolean;
  /** Chat history per peer (GATT messaging channel). */
  chats: Record<number, ChatMessage[]>;
  /** Peer whose chat is open, or null. */
  chatPeerId: number | null;
  /** Unread inbound message count per peer (cleared when their chat opens). */
  unread: Record<number, number>;
  hudVisible: boolean;

  setCapability: (report: SupportReport) => void;
  /** Replace the local peerId (after loading the persisted one at startup). */
  setLocalPeerId: (peerId: number) => void;
  setLocalTxPower: (dbm: number) => void;
  setLocalHeading: (headingDeg: number | null, accuracy: number) => void;
  /** Record a peer profile lookup result (or its in-flight/absent status). */
  setProfileEntry: (peerId: number, entry: ProfileEntry) => void;
  /** Apply a peer-supplied profile received over GATT (authoritative; no backend). */
  setPeerProfileFromGatt: (peerId: number, p: { name: string; interests: string[]; headline?: string }) => void;
  /** Set the local user's own profile (name + optional photo). */
  setMyProfile: (name: string | null, photoURL: string | null) => void;
  /** Set the local user's own discovery profile (interests + primary + headline). */
  setMyDiscovery: (interests: string[], primaryInterest: string | null, headline: string | null) => void;
  /** Choose the active interest catalog (per-event customization). */
  setActiveCatalog: (id: string) => void;
  /** Set the discovery visibility mode (off/open/curious/ghost). */
  setVisibility: (mode: Visibility) => void;
  /** Replace the ranked nearby list (written each discovery pass). */
  setNearby: (people: NearbyPerson[]) => void;
  /** Open/close the "People nearby" sheet. */
  setNearbyOpen: (open: boolean) => void;
  /** Open a peer's chat (or close with null); opening clears their unread count. */
  setChatPeer: (peerId: number | null) => void;
  /** Increment a peer's unread count (an inbound message while their chat is closed). */
  bumpUnread: (peerId: number) => void;
  /** Append a chat line for a peer. */
  pushChatMessage: (peerId: number, from: 'me' | 'them', text: string) => void;
  /** Send a chat message to a peer over the GATT channel (optimistically shown). */
  sendChat: (peerId: number, text: string) => void;
  /** The engine registers the transport sender here (null clears it). */
  registerChatSender: (fn: ((peerId: number, text: string) => void) | null) => void;
  setTunable: <K extends keyof Tunables>(key: K, value: Tunables[K]) => void;
  setBond: (bond: BondState) => void;
  setBonds: (bonds: BondState[]) => void;
  setPeerRows: (rows: PeerDebugRow[]) => void;
  setAdvertiserStatus: (advertising: boolean, error: string | null) => void;
  setScanError: (error: string | null) => void;
  /** Toggle the interop (GATT) path (debug). */
  setGattEnabled: (enabled: boolean) => void;
  /** Toggle proximity-only mode (true) vs. facing-required mode (false). */
  setProximityMode: (enabled: boolean) => void;
  /** Replace the per-peer transport map (written each publish tick). */
  setPeerTransports: (map: Record<number, 'adv' | 'gatt'>) => void;
  /** Update GATT status fields for the HUD. */
  setGattStatus: (status: Partial<AppState['gattStatus']>) => void;
  /** Record the last GATT connection error (null clears it). */
  setGattError: (error: string | null) => void;
  /** Open/close the enlarged profile card for a peer. */
  setExpandedPeer: (peerId: number | null) => void;
  /** Start broadcasting a reaction toward a peer (fresh nonce each call). */
  sendReaction: (targetPeerId: number, reactionId: number) => void;
  /** Stop broadcasting the current outgoing reaction. */
  clearOutgoingReaction: () => void;
  /** Record a received reaction (animate it) and start acking it to the sender. */
  pushIncomingReaction: (fromPeerId: number, reactionId: number, reactionNonce: number) => void;
  /** Stop broadcasting the current outgoing ack. */
  clearOutgoingAck: () => void;
  toggleHud: () => void;
}

/** A stable per-install hue derived from the session peer id. */
function hueForPeer(peerId: number): number {
  return peerId & 0xff;
}

// Chat plumbing kept OUT of reactive state: a monotonic key source and the
// imperative transport sender the signal engine registers (a function doesn't
// belong in the reactive store).
let chatKeySeq = 0;
let chatSenderRef: ((peerId: number, text: string) => void) | null = null;

export const useStore = create<AppState>((set, get) => {
  const localPeerId = getSessionPeerId();
  return {
    capability: null,
    localPeerId,
    localTxPower: DEFAULT_TX_POWER,
    localHeadingDeg: null,
    localHeadingAccuracy: 0,
    hue: hueForPeer(localPeerId),
    tunables: DEFAULT_TUNABLES,
    bond: EMPTY_BOND,
    bonds: [],
    peerRows: [],
    advertising: false,
    advertiserError: null,
    scanError: null,
    // Interop is ON by default on both platforms — a device should pick up peers
    // of either platform without any toggle. (The HUD toggle remains for debug.)
    // Android reads Android over ADV and iPhones over GATT; iOS is GATT-only.
    gattEnabled: true,
    // Proximity-only by default for the testing phase — closeness alone forms the
    // bond. Flip off in the HUD to bring back the face-to-face ritual (§3.2).
    proximityMode: true,
    peerTransports: {},
    gattStatus: { serverRunning: false, subscribers: 0, connections: 0 },
    gattError: null,
    expandedPeerId: null,
    outgoingReaction: null,
    outgoingAck: null,
    recentSentNonces: [],
    incomingReactions: [],
    profiles: {},
    myName: null,
    myPhotoURL: null,
    myInterests: [],
    myPrimaryInterest: null,
    myHeadline: null,
    activeCatalogId: DEFAULT_CATALOG_ID,
    visibility: 'off',
    nearby: [],
    nearbyOpen: false,
    chats: {},
    chatPeerId: null,
    unread: {},
    hudVisible: false,

    setCapability: (report) => set({ capability: report }),
    setLocalPeerId: (peerId) => set({ localPeerId: peerId, hue: hueForPeer(peerId) }),
    setLocalTxPower: (dbm) => set({ localTxPower: dbm }),
    setLocalHeading: (headingDeg, accuracy) =>
      set({ localHeadingDeg: headingDeg, localHeadingAccuracy: accuracy }),
    setTunable: (key, value) => set((s) => ({ tunables: { ...s.tunables, [key]: value } })),
    setBond: (bond) => set({ bond }),
    setBonds: (bonds) => set({ bonds }),
    setPeerRows: (rows) => set({ peerRows: rows }),
    setAdvertiserStatus: (advertising, error) => set({ advertising, advertiserError: error }),
    setScanError: (error) => set({ scanError: error }),
    setGattEnabled: (enabled) => set({ gattEnabled: enabled }),
    setProximityMode: (enabled) => set({ proximityMode: enabled }),
    setPeerTransports: (map) => set({ peerTransports: map }),
    setGattStatus: (status) => set((s) => ({ gattStatus: { ...s.gattStatus, ...status } })),
    setGattError: (error) => set({ gattError: error }),
    setExpandedPeer: (peerId) => set({ expandedPeerId: peerId }),
    sendReaction: (targetPeerId, reactionId) =>
      set((s) => {
        const nonce = ((s.outgoingReaction?.nonce ?? s.recentSentNonces[s.recentSentNonces.length - 1] ?? 0) % 255) + 1;
        return {
          outgoingReaction: { targetPeerId, reactionId, nonce, sentAt: Date.now() },
          recentSentNonces: [...s.recentSentNonces, nonce].slice(-8),
        };
      }),
    clearOutgoingReaction: () => set({ outgoingReaction: null }),
    pushIncomingReaction: (fromPeerId, reactionId, reactionNonce) =>
      set((s) => {
        const key = (s.incomingReactions[s.incomingReactions.length - 1]?.key ?? 0) + 1;
        const now = Date.now();
        const kept = s.incomingReactions.filter((r) => now - r.at < 2500);
        return {
          incomingReactions: [...kept, { key, fromPeerId, reactionId, at: now }].slice(-6),
          // Ack the sender so their device can play a "delivered" cue.
          outgoingAck: { targetPeerId: fromPeerId, nonce: reactionNonce, sentAt: now },
        };
      }),
    clearOutgoingAck: () => set({ outgoingAck: null }),
    setProfileEntry: (peerId, entry) =>
      set((s) => ({ profiles: { ...s.profiles, [peerId >>> 0]: entry } })),
    setPeerProfileFromGatt: (peerId, p) =>
      set((s) => {
        const key = peerId >>> 0;
        const prev = s.profiles[key];
        return {
          profiles: {
            ...s.profiles,
            [key]: {
              status: 'loaded',
              name: p.name,
              // Keep any photo already fetched from Firebase; GATT carries no photo.
              photoURL: prev?.photoURL ?? null,
              interests: p.interests,
              ...(p.headline ? { headline: p.headline } : {}),
              source: 'gatt',
            },
          },
        };
      }),
    setMyProfile: (name, photoURL) => set({ myName: name, myPhotoURL: photoURL }),
    setMyDiscovery: (interests, primaryInterest, headline) =>
      set({ myInterests: interests, myPrimaryInterest: primaryInterest, myHeadline: headline }),
    setActiveCatalog: (id) => set({ activeCatalogId: id }),
    setVisibility: (mode) => set({ visibility: mode }),
    setNearby: (people) => set({ nearby: people }),
    setNearbyOpen: (open) => set({ nearbyOpen: open }),
    setChatPeer: (peerId) =>
      set((s) => ({
        chatPeerId: peerId,
        unread: peerId == null ? s.unread : { ...s.unread, [peerId >>> 0]: 0 },
      })),
    bumpUnread: (peerId) =>
      set((s) => ({ unread: { ...s.unread, [peerId >>> 0]: (s.unread[peerId >>> 0] ?? 0) + 1 } })),
    pushChatMessage: (peerId, from, text) =>
      set((s) => {
        const key = (chatKeySeq += 1);
        const prev = s.chats[peerId >>> 0] ?? [];
        return { chats: { ...s.chats, [peerId >>> 0]: [...prev, { key, from, text, at: Date.now() }].slice(-200) } };
      }),
    sendChat: (peerId, text) => {
      const t = text.trim();
      if (!t) return;
      get().pushChatMessage(peerId, 'me', t);
      chatSenderRef?.(peerId >>> 0, t);
    },
    registerChatSender: (fn) => {
      chatSenderRef = fn;
    },
    toggleHud: () => set((s) => ({ hudVisible: !s.hudVisible })),
  };
});
