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
import { View, Pressable, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { CameraBridge } from './ar/CameraBridge';
import { ReactionBar } from './ui/Reactions';
import { DebugHUD } from './debug/DebugHUD';
import { MessageScreen } from './screens/MessageScreen';
import { CapabilityScreen } from './screens/CapabilityScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { requestAllPermissions } from './permissions';
import { isSupported, type SupportReport } from './ble/advertiser';
import { useStore } from './state/store';
import { useCompassHeading } from './sensors/useCompassHeading';
import { useAdvertiser } from './ble/useAdvertiser';
import { useIosPeripheral } from './ble/useIosPeripheral';
import { useBondEngine } from './signal/useBondEngine';
import { useProfiles } from './profiles/useProfiles';
import { loadOrCreatePeerId, loadMyProfile } from './identity/persistentId';

type Phase = 'checking' | 'permsDenied' | 'capability' | 'onboarding' | 'profile' | 'ready';

function MainExperience(): React.ReactElement {
  const toggleHud = useStore((s) => s.toggleHud);
  const gattEnabled = useStore((s) => s.gattEnabled);

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

  return (
    <View style={styles.fill}>
      <CameraBridge />
      <ReactionBar />
      {/* Hidden HUD toggle (P4-6): long-press the top-right corner. Rendered
          BEFORE the HUD so the HUD's modal overlay sits above it when open. */}
      <Pressable style={styles.hudTap} onLongPress={toggleHud} delayLongPress={600} />
      <DebugHUD />
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
});
