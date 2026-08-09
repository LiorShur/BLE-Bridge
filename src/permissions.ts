/**
 * Runtime permission flow (TASKS.md P0-5).
 *
 * All BLE + camera permissions are requested BEFORE any BLE or ARCore call.
 * On API 31+ the Bluetooth runtime permissions exist; below that only CAMERA is
 * a runtime permission (BLE scanning implied location was handled at install).
 * The scan permission is declared with `neverForLocation` in the manifest so the
 * system does not additionally force a location grant (CLAUDE.md §6).
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import { PermissionsAndroid, Platform, type Permission } from 'react-native';

export interface PermissionResult {
  granted: boolean;
  denied: string[];
}

function requiredPermissions(): Permission[] {
  const camera = PermissionsAndroid.PERMISSIONS.CAMERA;
  if (Platform.OS !== 'android') return [camera];
  const api = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  if (api >= 31) {
    return [
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      camera,
    ];
  }
  // API 26–30: location was required for BLE scanning historically, but this PoC
  // targets modern devices; camera is the only runtime grant we force here.
  return [camera];
}

export async function requestAllPermissions(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') return { granted: true, denied: [] };

  const perms = requiredPermissions();
  const result = await PermissionsAndroid.requestMultiple(perms);
  const denied = perms.filter((p) => result[p] !== PermissionsAndroid.RESULTS.GRANTED);
  return { granted: denied.length === 0, denied: denied.map(String) };
}
