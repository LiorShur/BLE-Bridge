/**
 * Firebase Web config. THIS FILE IS A STUB with empty defaults.
 *
 * The real values are injected by CI (`.github/workflows/android-build.yml`)
 * from repository secrets (FIREBASE_API_KEY, …) into the build's copy of this
 * file, so no key is ever committed. When every field is empty the profile
 * feature is simply disabled (`isFirebaseConfigured()` → false) and the app runs
 * exactly as before — see src/lib/profiles.ts.
 *
 * These Firebase Web keys are not secrets in the security sense (they ship in
 * every web client), but injecting them keeps the repo clean and the backend
 * swappable.
 */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  appId: string;
}

export const firebaseConfig: FirebaseWebConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  appId: '',
};

/** True once CI (or a local dev) has filled in the config. */
export function isFirebaseConfigured(): boolean {
  return firebaseConfig.apiKey !== '' && firebaseConfig.projectId !== '';
}
