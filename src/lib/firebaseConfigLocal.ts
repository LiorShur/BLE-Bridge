/**
 * PER-MACHINE Firebase Web config override. EMPTY in the repo on purpose.
 *
 * Why this exists: the real Firebase Web config is injected from GitHub Secrets
 * ONLY during the Android CI build (scripts/gen-firebase-config.js). A LOCAL build
 * that CI doesn't run — notably an iOS build from Xcode — therefore ships the empty
 * `firebaseConfig.ts` stub and Firebase stays off (`firebase-unconfigured`). This
 * file lets such a build supply the same config WITHOUT committing keys.
 *
 * These five values are the public Firebase *Web* config (the same object that
 * ships in every web client) — NOT admin credentials. They are safe to place on
 * your machine; they are simply kept out of the committed repo.
 *
 * To turn Firebase on for a local iOS build (one time, on your Mac):
 *   1. Fill in the five fields below with your project's values
 *      (Firebase console → Project settings → your Web app → SDK config).
 *   2. Tell git to ignore your local edits so `git pull` never wipes them and you
 *      never accidentally commit the keys:
 *        git update-index --skip-worktree src/lib/firebaseConfigLocal.ts
 *      (to undo later: git update-index --no-skip-worktree src/lib/firebaseConfigLocal.ts)
 *   3. Copy your edit into the iOS build shell — the Xcode build compiles from
 *      ios-shell/src, NOT this file directly, so editing here has no effect until:
 *        bash scripts/ios-update.sh
 *      Verify: `cat ios-shell/src/lib/firebaseConfigLocal.ts` shows your real values.
 *   4. In Xcode: Clean Build Folder (Shift+Cmd+K), then Run.
 *
 * Any non-empty field here overrides the CI-injected value (see
 * firebaseConfigResolved.ts). Leave it empty and nothing changes — the injected
 * config (or the disabled stub) is used exactly as before.
 */
import type { FirebaseWebConfig } from './firebaseConfig';

export const firebaseConfigLocal: Partial<FirebaseWebConfig> = {
  // apiKey: 'AIza...',
  // authDomain: 'your-project.firebaseapp.com',
  // projectId: 'your-project',
  // storageBucket: 'your-project.appspot.com',
  // appId: '1:1234567890:web:abcdef',
};
