/**
 * Startup capability report (TASKS.md P0-6). Reports, plainly on screen (not in
 * logs), per device: Bluetooth enabled · advertising supported · ARCore
 * available · compass present. If advertising is unsupported the app cannot
 * work — say so and stop, per Gate P0.
 *
 * NOTE: depends on React Native; not testable off-device.
 */
import React from 'react';
import { View, Text, Platform, StyleSheet } from 'react-native';
import type { SupportReport } from '../ble/advertiser';
import type { ArCoreReport } from '../ar/arcore';
import { MessageScreen } from './MessageScreen';

export interface CapabilityScreenProps {
  support: SupportReport;
  /** Stage 2 only: ARCore availability. Omitted in Stage 1 (no camera/AR). */
  arCore?: ArCoreReport;
  /** Stage 2 only: compass presence. Omitted in Stage 1 (proximity-only). */
  compassPresent?: boolean;
  onContinue?: () => void;
}

function Check({
  ok,
  label,
  detail,
  tone = 'check',
}: {
  ok: boolean;
  label: string;
  detail?: string;
  /** 'check' = pass/fail (✓/✗). 'info' = neutral (◦), for things not yet knowable. */
  tone?: 'check' | 'info';
}): React.ReactElement {
  const glyph = tone === 'info' ? '◦' : ok ? '✓' : '✗';
  const color = tone === 'info' ? '#9fb3c8' : ok ? '#5ef0a8' : '#ff6b6b';
  return (
    <View style={styles.line}>
      <Text style={[styles.icon, { color }]}>{glyph}</Text>
      <View style={styles.lineText}>
        <Text style={styles.label}>{label}</Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      </View>
    </View>
  );
}

export function CapabilityScreen({ support, arCore, compassPresent, onContinue }: CapabilityScreenProps): React.ReactElement {
  // iOS can't advertise manufacturer data, so it never reports
  // advertisingSupported — but it IS discoverable over the GATT peripheral
  // (docs/GATT_SPEC.md). So on iOS the Android multiple-advertisement check is
  // irrelevant and must not read as "broken / try a different phone".
  const isIOS = Platform.OS === 'ios';
  const advertisingBlocked = !isIOS && !support.advertisingSupported;
  // Gate on BLE (+ ARCore where checked). Compass is informational: if it's
  // missing/uncalibrated the alignment math falls back to proximity (§4.3).
  const allGo = !advertisingBlocked && support.supported && (arCore ? arCore.available : true);

  return (
    <MessageScreen
      title="Device check"
      body={
        advertisingBlocked
          ? 'This device cannot advertise over BLE, which the whole experience depends on. Try a different phone.'
          : allGo
            ? 'All systems go.'
            : 'Some capabilities are missing — see below.'
      }
      actionLabel={allGo && onContinue ? 'Continue' : undefined}
      onAction={allGo ? onContinue : undefined}
    >
      <View style={styles.checks}>
        <Check ok={support.bluetoothPresent} label="Bluetooth present" />
        <Check ok={support.bluetoothEnabled} label="Bluetooth enabled" detail={support.bluetoothEnabled ? undefined : 'Turn Bluetooth on.'} />
        {isIOS ? (
          // On iPhone, discoverability is the GATT peripheral, not BLE advertising.
          <Check ok label="Discoverable (GATT)" detail="iPhone is found over the interop path." />
        ) : (
          <Check
            ok={support.advertisingSupported}
            label="BLE advertising supported"
            detail={support.advertisingSupported ? undefined : 'isMultipleAdvertisementSupported = false.'}
          />
        )}
        {arCore ? <Check ok={arCore.available} label="ARCore available" detail={arCore.reason} /> : null}
        {compassPresent !== undefined ? (
          // Compass readiness isn't knowable yet at this screen (the sensor starts
          // with the experience), so present it as info, not a pass/fail — a ✗ here
          // read as "no compass" when it just hadn't started.
          compassPresent ? (
            <Check ok label="Compass ready" />
          ) : (
            <Check ok={false} tone="info" label="Compass" detail="Starts with the experience; face-to-face uses it, else proximity." />
          )
        ) : null}
      </View>
    </MessageScreen>
  );
}

const styles = StyleSheet.create({
  checks: { marginTop: 18 },
  line: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  icon: { fontSize: 18, width: 26, fontWeight: '800' },
  lineText: { flex: 1 },
  label: { color: '#e6f1ff', fontSize: 15 },
  detail: { color: '#9fb3c8', fontSize: 12, marginTop: 2 },
});
