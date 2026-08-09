/**
 * React Native entry point. Registers the root component (src/App.tsx).
 * The app name must match app.json and the native MainActivity's
 * getMainComponentName().
 */
import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
