/**
 * App root: permission gate → capability gate → onboarding → AR experience.
 *
 * The four signal hooks (heading, advertiser, scan/bond engine) live in
 * <MainExperience> so they mount together, exactly once, only when the device
 * has passed every gate. The AR scene and HUD read the store; nothing here
 * reaches into Bluetooth directly (CLAUDE.md §3.4).
 *
 * NOTE: depends on React Native + Viro; not testable off-device.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { ViroARSceneNavigator } from '@reactvision/react-viro';
import { BridgeScene } from './ar/BridgeScene.js';
import { DebugHUD } from './debug/DebugHUD.js';
import { MessageScreen } from './screens/MessageScreen.js';
import { CapabilityScreen } from './screens/CapabilityScreen.js';
import { OnboardingScreen } from './screens/OnboardingScreen.js';
import { requestAllPermissions } from './permissions.js';
import { isSupported, type SupportReport } from './ble/advertiser.js';
import { checkArCore, type ArCoreReport } from './ar/arcore.js';
import { useStore } from './state/store.js';
import { useHeading } from './sensors/useHeading.js';
import { useAdvertiser } from './ble/useAdvertiser.js';
import { useBondEngine } from './signal/useBondEngine.js';

type Phase = 'checking' | 'permsDenied' | 'capability' | 'onboarding' | 'ready';

function MainExperience(): React.ReactElement {
  const toggleHud = useStore((s) => s.toggleHud);

  // Mount the full signal stack exactly once.
  useHeading();
  useAdvertiser(true);
  useBondEngine(true);

  return (
    <View style={styles.fill}>
      <ViroARSceneNavigator autofocus initialScene={{ scene: BridgeScene }} style={styles.fill} />
      <DebugHUD />
      {/* Hidden HUD toggle (P4-6): long-press the top-right corner. A three-finger
          gesture is the eventual affordance; this corner target is the placeholder. */}
      <Pressable style={styles.hudTap} onLongPress={toggleHud} delayLongPress={600} />
    </View>
  );
}

export default function App(): React.ReactElement {
  const [phase, setPhase] = useState<Phase>('checking');
  const [support, setSupport] = useState<SupportReport | null>(null);
  const [arCore, setArCore] = useState<ArCoreReport>({ available: false });
  const setCapability = useStore((s) => s.setCapability);
  const headingAccuracy = useStore((s) => s.localHeadingAccuracy);
  const headingDeg = useStore((s) => s.localHeadingDeg);
  const compassPresent = headingDeg !== null || headingAccuracy > 0;

  const runChecks = useCallback(async (): Promise<void> => {
    setPhase('checking');
    const perms = await requestAllPermissions();
    if (!perms.granted) {
      setPhase('permsDenied');
      return;
    }
    const [report, ar] = await Promise.all([isSupported(), checkArCore()]);
    setSupport(report);
    setArCore(ar);
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
        <CapabilityScreen
          support={support}
          arCore={arCore}
          compassPresent={compassPresent}
          onContinue={() => setPhase('onboarding')}
        />
      ) : (
        <MessageScreen title="Starting up" body="Checking hardware…" />
      );

    case 'onboarding':
      return <OnboardingScreen onStart={() => setPhase('ready')} />;

    case 'ready':
      return <MainExperience />;
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  spinner: { marginTop: 18 },
  hudTap: { position: 'absolute', top: 0, right: 0, width: 64, height: 64 },
});
