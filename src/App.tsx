/**
 * App root: permission gate → capability gate → onboarding → experience.
 *
 * The signal hooks (heading, advertiser, scan/bond engine) live in
 * <MainExperience> so they mount together, exactly once, only after every gate
 * passes. The view layer reads the store; nothing here touches Bluetooth
 * directly (CLAUDE.md §3.4).
 *
 * Stage 1 renders the 2D bridge view (no camera/AR). Stage 2 flips
 * config.AR_ENABLED and swaps in the ViroAR scene — see src/config.ts / BUILD.md.
 *
 * NOTE: depends on React Native; not testable off-device.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { BridgeView2D } from './ui/BridgeView2D';
import { DebugHUD } from './debug/DebugHUD';
import { MessageScreen } from './screens/MessageScreen';
import { CapabilityScreen } from './screens/CapabilityScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { requestAllPermissions } from './permissions';
import { isSupported, type SupportReport } from './ble/advertiser';
import { useStore } from './state/store';
import { useHeading } from './sensors/useHeading';
import { useAdvertiser } from './ble/useAdvertiser';
import { useBondEngine } from './signal/useBondEngine';

type Phase = 'checking' | 'permsDenied' | 'capability' | 'onboarding' | 'ready';

function MainExperience(): React.ReactElement {
  const toggleHud = useStore((s) => s.toggleHud);

  // Mount the full signal stack exactly once.
  useHeading();
  useAdvertiser(true);
  useBondEngine(true);

  return (
    <View style={styles.fill}>
      <BridgeView2D />
      <DebugHUD />
      {/* Hidden HUD toggle (P4-6): long-press the top-right corner. */}
      <Pressable style={styles.hudTap} onLongPress={toggleHud} delayLongPress={600} />
    </View>
  );
}

export default function App(): React.ReactElement {
  const [phase, setPhase] = useState<Phase>('checking');
  const [support, setSupport] = useState<SupportReport | null>(null);
  const setCapability = useStore((s) => s.setCapability);

  const runChecks = useCallback(async (): Promise<void> => {
    setPhase('checking');
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
        <MessageScreen title="Starting up" body="Checking permissions and Bluetooth…">
          <ActivityIndicator color="#7cf9ff" style={styles.spinner} />
        </MessageScreen>
      );

    case 'permsDenied':
      return (
        <MessageScreen
          title="Permissions needed"
          body="AuraBridge needs Bluetooth access to find nearby people. Nothing leaves your device."
          actionLabel="Grant access"
          onAction={() => void runChecks()}
        />
      );

    case 'capability':
      return support ? (
        <CapabilityScreen support={support} onContinue={() => setPhase('onboarding')} />
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
