const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro config. `@reactvision/react-viro` ships assets that Metro must be told
 * about via the standard default asset list; no extra config is required for the
 * PoC beyond the RN defaults.
 */
const config = {};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
