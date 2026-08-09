/**
 * Debug HUD (TASKS.md P1-9, P2-8). A first-class feature, not scaffolding —
 * it is the only way to diagnose radio behaviour (CLAUDE.md §7).
 *
 * Shows the local identity/heading, advertiser + scan status, every discovered
 * peer's full signal chain, and live sliders for the tunable constants so they
 * can be tuned on-device. Behind a hidden gesture in production (P4-6).
 *
 * Sliders are a tiny pure-JS control (Views + PanResponder), NOT the community
 * native Slider, which rendered unreliably (0-width) on some EMUI builds.
 *
 * NOTE: depends on React Native; not testable off-device.
 */
import React, { useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, PanResponder, type GestureResponderEvent } from 'react-native';
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

/**
 * Minimal, dependency-free slider: a track + fill + knob driven by touches via
 * PanResponder. Renders identically on every Android build (the whole reason it
 * exists — the native community Slider did not).
 */
function MiniSlider({
  value,
  min,
  max,
  step,
  onChange,
  color,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  color: string;
}): React.ReactElement {
  const widthRef = useRef(1);

  const apply = (x: number): void => {
    const w = widthRef.current || 1;
    let f = x / w;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    let v = min + f * (max - min);
    v = Math.round(v / step) * step;
    v = v < min ? min : v > max ? max : v;
    onChange(v);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: GestureResponderEvent) => apply(e.nativeEvent.locationX),
      onPanResponderMove: (e: GestureResponderEvent) => apply(e.nativeEvent.locationX),
    }),
  ).current;

  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));

  return (
    <View
      style={styles.track}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width;
      }}
      {...pan.panHandlers}
    >
      <View style={styles.trackBar} />
      <View style={[styles.trackFill, { width: `${frac * 100}%`, backgroundColor: color }]} />
      <View style={[styles.knob, { left: `${frac * 100}%`, backgroundColor: color }]} />
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
      <MiniSlider value={value} min={min} max={max} step={step} color="#7cf9ff" onChange={(v) => setTunable(k, v)} />
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
      <MiniSlider value={txPower} min={-80} max={-40} step={1} color="#5ef0a8" onChange={(v) => setLocalTxPower(Math.round(v))} />
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
  const scanError = useStore((s) => s.scanError);
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
      <Row label="scan" value={scanError ? `ERR ${scanError}` : peers.length > 0 ? 'ok' : 'no results'} />

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
      <TunableSlider label="align floor" k="alignFloor" min={0} max={1} step={0.05} />
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
  sliderRow: { marginTop: 10 },
  sliderLabel: { color: '#cdd9e5', fontSize: 11, marginBottom: 4 },
  // Pure-JS slider parts.
  track: { height: 32, justifyContent: 'center' },
  trackBar: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: '#26324a' },
  trackFill: { position: 'absolute', left: 0, height: 4, borderRadius: 2 },
  knob: { position: 'absolute', width: 18, height: 18, borderRadius: 9, marginLeft: -9 },
});
