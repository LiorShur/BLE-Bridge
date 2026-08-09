/**
 * Runtime permission flow (TASKS.md P0-5).
 *
 * All BLE (and, in Stage 2, camera) permissions are requested BEFORE any BLE or
 * ARCore call. On API 31+ the Bluetooth runtime permissions exist; below that
 * they were install-time. The scan permission is declared `neverForLocation` in
 * the manifest so the system does not additionally force a location grant
 * (CLAUDE.md §6). Camera is only requested when AR is enabled (Stage 2).
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import { PermissionsAndroid, Platform, type Permission } from 'react-native';
import { AR_ENABLED } from './config';

export interface PermissionResult {
  granted: boolean;
  denied: string[];
}

function requiredPermissions(): Permission[] {
  if (Platform.OS !== 'android') return [];
  const api = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  const perms: Permission[] = [];
  if (api >= 31) {
    perms.push(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    );
  }
  // API 26–30 scanning required location historically; this PoC targets modern
  // devices, so no runtime grant is forced there in Stage 1.
  if (AR_ENABLED) perms.push(PermissionsAndroid.PERMISSIONS.CAMERA);
  return perms;
}

export async function requestAllPermissions(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') return { granted: true, denied: [] };

  const perms = requiredPermissions();
  if (perms.length === 0) return { granted: true, denied: [] };

  const result = await PermissionsAndroid.requestMultiple(perms);
  const denied = perms.filter((p) => result[p] !== PermissionsAndroid.RESULTS.GRANTED);
  return { granted: denied.length === 0, denied: denied.map(String) };
}
