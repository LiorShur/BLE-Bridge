/**
 * Debug HUD (TASKS.md P1-9, P2-8). A first-class feature, not scaffolding —
 * it is the only way to diagnose radio behaviour (CLAUDE.md §7).
 *
 * Shows the local identity/heading, every discovered peer's full signal chain,
 * and live sliders for the tunable constants so they can be tuned on-device
 * without a rebuild. Behind a hidden gesture in production (P4-6).
 *
 * NOTE: depends on React Native; not testable off-device.
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import Slider from '@react-native-community/slider';
import { useStore, type Tunables } from '../state/store';
import { useNearbyPeers } from '../ble/useNearbyPeers';

/** Android device model (Build.MODEL), for calibration bookkeeping. */
const DEVICE_MODEL: string =
  Platform.OS === 'android' ? ((Platform.constants as { Model?: string }).Model ?? 'android') : Platform.OS;

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.row}>
      <Text style={styles.key}>{label}</Text>
      <Text style={styles.val}>{value}</Text>
    </View>
  );
}

function TunableSlider({
  label,
  k,
  min,
  max,
  step,
}: {
  label: string;
  k: keyof Tunables;
  min: number;
  max: number;
  step: number;
}): React.ReactElement {
  const value = useStore((s) => s.tunables[k]);
  const setTunable = useStore((s) => s.setTunable);
  return (
    <View style={styles.sliderRow}>
      <Text style={styles.sliderLabel}>
        {label}: {value.toFixed(2)}
      </Text>
      <Slider
        style={styles.slider}
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onValueChange={(v: number) => setTunable(k, v)}
        minimumTrackTintColor="#7cf9ff"
        maximumTrackTintColor="#334"
        thumbTintColor="#7cf9ff"
      />
    </View>
  );
}

/**
 * Live control of THIS device's advertised txPower (dBm @ 1 m). Because each
 * device advertises its own reference and peers use it in the distance model,
 * nudging this equalizes two phones that read the same gap differently
 * (PAYLOAD_SPEC §3). Raising it makes peers see this device as closer.
 */
function TxPowerSlider(): React.ReactElement {
  const txPower = useStore((s) => s.localTxPower);
  const setLocalTxPower = useStore((s) => s.setLocalTxPower);
  return (
    <View style={styles.sliderRow}>
      <Text style={styles.sliderLabel}>my txPower (dBm): {txPower}</Text>
      <Slider
        style={styles.slider}
        minimumValue={-80}
        maximumValue={-40}
        step={1}
        value={txPower}
        onValueChange={(v: number) => setLocalTxPower(Math.round(v))}
        minimumTrackTintColor="#5ef0a8"
        maximumTrackTintColor="#334"
        thumbTintColor="#5ef0a8"
      />
    </View>
  );
}

export function DebugHUD(): React.ReactElement | null {
  const visible = useStore((s) => s.hudVisible);
  const localPeerId = useStore((s) => s.localPeerId);
  const localTxPower = useStore((s) => s.localTxPower);
  const headingDeg = useStore((s) => s.localHeadingDeg);
  const headingAccuracy = useStore((s) => s.localHeadingAccuracy);
  const advertising = useStore((s) => s.advertising);
  const advertiserError = useStore((s) => s.advertiserError);
  const bond = useStore((s) => s.bond);
  const peers = useNearbyPeers();

  if (!visible) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.h}>LOCAL</Text>
      <Row label="model" value={DEVICE_MODEL} />
      <Row label="peerId" value={`0x${localPeerId.toString(16).padStart(8, '0')}`} />
      <Row label="txPower" value={`${localTxPower} dBm`} />
      <Row label="heading" value={headingDeg === null ? 'n/a' : `${headingDeg.toFixed(1)}°`} />
      <Row label="hdg acc" value={String(headingAccuracy)} />
      <Row label="advertising" value={advertising ? 'YES' : advertiserError ? `ERR ${advertiserError}` : 'starting…'} />

      <Text style={styles.h}>PRIMARY BOND</Text>
      <Row label="proximity" value={bond.proximity.toFixed(3)} />
      <Row label="alignment" value={bond.alignment.toFixed(3)} />
      <Row label="strength" value={bond.strength.toFixed(3)} />
      <Row label="bonded" value={bond.bonded ? 'YES' : 'no'} />

      <Text style={styles.h}>PEERS ({peers.length})</Text>
      {peers.map((p) => (
        <View key={p.peerId} style={styles.peer}>
          <Row label="peerId" value={`0x${p.peerId.toString(16).padStart(8, '0')}`} />
          <Row label="rssi/smoothed" value={`${p.rssi} / ${p.smoothedRssi.toFixed(1)} dBm`} />
          <Row label="distance" value={`${p.distanceM.toFixed(2)} m`} />
          <Row label="prox/align" value={`${p.proximity.toFixed(2)} / ${p.alignment.toFixed(2)}`} />
          <Row label="raw/strength" value={`${p.raw.toFixed(2)} / ${p.strength.toFixed(2)}`} />
          <Row label="peer txPower" value={`${p.txPower} dBm`} />
          <Row label="peer heading" value={p.headingDeg === null ? 'n/a' : `${p.headingDeg.toFixed(1)}° (acc ${p.headingAccuracy})`} />
          <Row label="flags/seq" value={`0x${p.flags.toString(16)} / ${p.sequence}`} />
          <Row label="rate/age" value={`${p.packetsPerSecond} Hz / ${p.ageMs} ms`} />
        </View>
      ))}

      <Text style={styles.h}>TUNABLES</Text>
      <TxPowerSlider />
      <TunableSlider label="α (RSSI EMA)" k="alpha" min={0.05} max={0.6} step={0.01} />
      <TunableSlider label="n (path loss)" k="pathLossN" min={1.6} max={3.5} step={0.1} />
      <TunableSlider label="D_NEAR (m)" k="dNear" min={0.2} max={2} step={0.1} />
      <TunableSlider label="D_FAR (m)" k="dFar" min={3} max={10} step={0.5} />
      <TunableSlider label="TOLERANCE (°)" k="toleranceDeg" min={20} max={90} step={5} />
      <TunableSlider label="form >" k="formThreshold" min={0.3} max={0.9} step={0.05} />
      <TunableSlider label="break <" k="breakThreshold" min={0.1} max={0.6} step={0.05} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 40,
    left: 8,
    right: 8,
    maxHeight: '70%',
    backgroundColor: 'rgba(6,10,26,0.85)',
    borderRadius: 10,
    padding: 10,
  },
  content: { paddingBottom: 24 },
  h: { color: '#7cf9ff', fontWeight: '700', marginTop: 10, marginBottom: 4, fontSize: 12, letterSpacing: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  key: { color: '#9fb3c8', fontSize: 11 },
  val: { color: '#e6f1ff', fontSize: 11, fontVariant: ['tabular-nums'] },
  peer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#26324a', marginTop: 6, paddingTop: 6 },
  sliderRow: { marginTop: 6 },
  sliderLabel: { color: '#cdd9e5', fontSize: 11 },
  // Explicit height — the community Slider collapses to 0 on some older Android
  // builds (e.g. EMUI) without it, hiding the track.
  slider: { height: 40, width: '100%' },
});
