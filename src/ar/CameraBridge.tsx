/**
 * Full-screen camera preview with the bridge overlay on top — the AR-lite
 * experience that replaces Viro/ARCore (unavailable on the target devices).
 *
 * Camera is preview-only (no capture, no frame processing); the bridge is drawn
 * straight ahead (CLAUDE.md §3.2), so no world tracking is needed. If the camera
 * or its permission is unavailable, the overlay still renders on a dark
 * background — the app never dead-ends.
 *
 * NOTE: depends on React Native + react-native-vision-camera; not testable off-device.
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { BridgeOverlay } from '../ui/BridgeOverlay';

export function CameraBridge(): React.ReactElement {
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();

  useEffect(() => {
    if (!hasPermission) void requestPermission();
  }, [hasPermission, requestPermission]);

  return (
    <View style={styles.fill}>
      {device && hasPermission ? (
        <Camera style={StyleSheet.absoluteFill} device={device} isActive />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.noCam]}>
          <Text style={styles.noCamText}>{hasPermission ? 'No camera found' : 'Camera permission needed'}</Text>
        </View>
      )}
      <BridgeOverlay />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#060a1a' },
  noCam: { backgroundColor: '#060a1a', alignItems: 'center', justifyContent: 'center' },
  noCamText: { color: '#7f93ab', fontSize: 15 },
});
