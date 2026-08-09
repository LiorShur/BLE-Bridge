/**
 * Startup capability report (TASKS.md P0-6). Reports, plainly on screen (not in
 * logs), per device: Bluetooth enabled · advertising supported · ARCore
 * available · compass present. If advertising is unsupported the app cannot
 * work — say so and stop, per Gate P0.
 *
 * NOTE: depends on React Native; not testable off-device.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { SupportReport } from '../ble/advertiser.js';
import type { ArCoreReport } from '../ar/arcore.js';
import { MessageScreen } from './MessageScreen.js';

export interface CapabilityScreenProps {
  support: SupportReport;
  arCore: ArCoreReport;
  compassPresent: boolean;
  onContinue?: () => void;
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail?: string }): React.ReactElement {
  return (
    <View style={styles.line}>
      <Text style={[styles.icon, { color: ok ? '#5ef0a8' : '#ff6b6b' }]}>{ok ? '✓' : '✗'}</Text>
      <View style={styles.lineText}>
        <Text style={styles.label}>{label}</Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      </View>
    </View>
  );
}

export function CapabilityScreen({ support, arCore, compassPresent, onContinue }: CapabilityScreenProps): React.ReactElement {
  const advertisingBlocked = !support.advertisingSupported;
  const allGo = support.supported && arCore.available && compassPresent;

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
        <Check
          ok={support.advertisingSupported}
          label="BLE advertising supported"
          detail={support.advertisingSupported ? undefined : 'isMultipleAdvertisementSupported = false.'}
        />
        <Check ok={arCore.available} label="ARCore available" detail={arCore.reason} />
        <Check ok={compassPresent} label="Compass present" detail={compassPresent ? undefined : 'Effect will run on proximity alone.'} />
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
