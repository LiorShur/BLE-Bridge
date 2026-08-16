/**
 * App root: permission gate → capability gate → onboarding → experience.
 *
 * The signal hooks (heading, advertiser, scan/bond engine) live in
 * <MainExperience> so they mount together, exactly once, after every gate
 * passes. The view layer reads the store; nothing here touches Bluetooth
 * directly (CLAUDE.md §3.4).
 *
 * Stage 2: renders the ViroAR bridge scene over the camera and drives alignment
 * from the native compass. Stage 1's 2D view (BridgeView2D) is retained for the
 * Viro-free build path (src/config.ts).
 *
 * NOTE: depends on React Native + Viro; not testable off-device.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform, LogBox } from 'react-native';

// Offline, the Firestore SDK logs noisy "could not reach backend" / transport
// errors while it retries in the background. They're non-fatal (the app falls back
// to the local cache + Bluetooth), so keep them out of the dev red-box. No-op in
// release builds.
LogBox.ignoreLogs([/@firebase\/firestore/, 'Could not reach Cloud Firestore backend', /WebChannelConnection/]);
import { CameraBridge } from './ar/CameraBridge';
import { ReactionBar } from './ui/Reactions';
import { DebugHUD } from './debug/DebugHUD';
import { MessageScreen } from './screens/MessageScreen';
import { CapabilityScreen } from './screens/CapabilityScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { requestAllPermissions } from './permissions';
import { isSupported, type SupportReport } from './ble/advertiser';
import { useStore, isBrowsing, showsNudges, type Visibility } from './state/store';
import { useCompassHeading } from './sensors/useCompassHeading';
import { useAdvertiser } from './ble/useAdvertiser';
import { useIosPeripheral } from './ble/useIosPeripheral';
import { useBondEngine } from './signal/useBondEngine';
import { useProfiles } from './profiles/useProfiles';
import { useProfileSync } from './profiles/useProfileSync';
import { useDiscovery } from './discovery/useDiscovery';
import { NearbySheet } from './features/nearby/NearbySheet';
import { ChatSheet } from './features/chat/ChatSheet';
import { loadOrCreatePeerId, loadMyProfile } from './identity/persistentId';
import { loadPeerProfileCache } from './profiles/profileCache';

type Phase = 'checking' | 'permsDenied' | 'capability' | 'onboarding' | 'profile' | 'ready';

function MainExperience(): React.ReactElement {
  const toggleHud = useStore((s) => s.toggleHud);
  const gattEnabled = useStore((s) => s.gattEnabled);
  const setNearbyOpen = useStore((s) => s.setNearbyOpen);
  const visibility = useStore((s) => s.visibility);
  const strongCount = useStore((s) => s.nearby.filter((n) => n.strong).length);
  const browsing = isBrowsing(visibility);
  const syncPending = useStore((s) => s.profileSyncPending);

  // Mount the full signal stack. On iOS (P-i2a) there's no native advertiser yet,
  // so advertising is not mounted — the iPhone participates as a GATT central and
  // bonds to interop-enabled Androids it connects to.
  useCompassHeading();
  useAdvertiser(Platform.OS !== 'ios', gattEnabled);
  // iOS peripheral (P-i2b): advertise the service UUID + serve the payload over
  // GATT so Android can discover the iPhone. No-op until the Swift module is added.
  useIosPeripheral(Platform.OS === 'ios');
  useBondEngine(true, gattEnabled);
  useProfiles();
  // Flush any offline profile edit to the cloud once connectivity returns.
  useProfileSync();
  // Discovery (D3): rank nearby looking peers by shared interests.
  useDiscovery();

  return (
    <View style={styles.fill}>
      <CameraBridge />
      <ReactionBar />
      {/* Discovery entry point (top-left): opens the "People nearby" sheet. Shows
          a badge when strong matches are present. Dimmed while discovery is off. */}
      <Pressable
        style={[styles.nearbyTab, browsing ? styles.nearbyTabOn : null]}
        onPress={() => setNearbyOpen(true)}
      >
        <Text style={styles.nearbyTabText}>{browsing ? '✨ Nearby' : '✨ Meet'}</Text>
        {showsNudges(visibility) && strongCount > 0 ? (
          <View style={styles.nearbyBadge}>
            <Text style={styles.nearbyBadgeText}>{strongCount}</Text>
          </View>
        ) : null}
      </Pressable>
      {/* Hidden HUD toggle (P4-6): long-press the top-right corner. Rendered
          BEFORE the HUD so the HUD's modal overlay sits above it when open. */}
      <Pressable style={styles.hudTap} onLongPress={toggleHud} delayLongPress={600} />
      {syncPending ? (
        <View style={styles.syncBanner} pointerEvents="none">
          <Text style={styles.syncBannerText}>Offline — your profile will sync when you’re back online</Text>
        </View>
      ) : null}
      <DebugHUD />
      <NearbySheet />
      <ChatSheet />
    </View>
  );
}

export default function App(): React.ReactElement {
  const [phase, setPhase] = useState<Phase>('checking');
  const [support, setSupport] = useState<SupportReport | null>(null);
  const setCapability = useStore((s) => s.setCapability);
  const headingDeg = useStore((s) => s.localHeadingDeg);
  const headingAccuracy = useStore((s) => s.localHeadingAccuracy);
  const compassPresent = headingDeg !== null || headingAccuracy > 0;

  const runChecks = useCallback(async (): Promise<void> => {
    setPhase('checking');
    // Load the persistent identity + own profile before anything advertises, so
    // peerId (and the profile keyed by it) is stable for this launch.
    const store = useStore.getState();
    const peerId = await loadOrCreatePeerId();
    store.setLocalPeerId(peerId);
    const mine = await loadMyProfile();
    store.setMyProfile(mine.name, mine.photoURL);
    store.setMyPhotoThumb(mine.photoThumb);
    store.setMyDiscovery(mine.interests, mine.primaryInterest, mine.headline);
    if (mine.activeCatalogId) store.setActiveCatalog(mine.activeCatalogId);
    if (mine.visibility) store.setVisibility(mine.visibility as Visibility);

    // Redundancy: hydrate previously-seen PEER profiles from the local cache so a
    // known peer shows their name/photo immediately — even offline or before any
    // Firebase fetch. Marked 'cache' so useProfiles still refreshes them when it can.
    const cached = await loadPeerProfileCache();
    for (const [id, c] of Object.entries(cached)) {
      store.setProfileEntry(Number(id), {
        status: 'loaded',
        source: 'cache',
        ...(c.name ? { name: c.name } : {}),
        ...(c.photoURL !== undefined ? { photoURL: c.photoURL } : {}),
        ...(c.interests ? { interests: c.interests } : {}),
        ...(c.headline ? { headline: c.headline } : {}),
      });
    }

    const perms = await requestAllPermissions();
    if (!perms.granted) {
      setPhase('permsDenied');
      return;
    }
    const report = await isSupported();
    setSupport(report);
    setCapability(report);
    setPhase('capability');
  }, [setCapability]);

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  switch (phase) {
    case 'checking':
      return (
        <MessageScreen title="Starting up" body="Checking permissions and hardware…">
          <ActivityIndicator color="#7cf9ff" style={styles.spinner} />
        </MessageScreen>
      );

    case 'permsDenied':
      return (
        <MessageScreen
          title="Permissions needed"
          body="AuraBridge needs Bluetooth and Camera access to find nearby people and draw the bridge. Nothing leaves your device."
          actionLabel="Grant access"
          onAction={() => void runChecks()}
        />
      );

    case 'capability':
      return support ? (
        <CapabilityScreen support={support} compassPresent={compassPresent} onContinue={() => setPhase('onboarding')} />
      ) : (
        <MessageScreen title="Starting up" body="Checking hardware…" />
      );

    case 'onboarding':
      return <OnboardingScreen onStart={() => setPhase('profile')} />;

    case 'profile':
      return <ProfileScreen onDone={() => setPhase('ready')} />;

    case 'ready':
      return <MainExperience />;
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  spinner: { marginTop: 18 },
  hudTap: { position: 'absolute', top: 0, right: 0, width: 64, height: 64 },
  nearbyTab: {
    position: 'absolute',
    top: 48,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(6,10,26,0.6)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(124,249,255,0.25)',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  nearbyTabOn: { borderColor: '#7cf9ff', backgroundColor: 'rgba(124,249,255,0.14)' },
  nearbyTabText: { color: '#cfe0f5', fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  nearbyBadge: {
    marginLeft: 7,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ff5f8f',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  nearbyBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  syncBanner: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    maxWidth: '90%',
    backgroundColor: 'rgba(6,10,26,0.82)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(124,249,255,0.25)',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  syncBannerText: { color: '#cfe0f5', fontSize: 12, fontWeight: '600', textAlign: 'center' },
});
