/**
 * The Firebase config the app actually uses: the CI-injected config
 * (firebaseConfig.ts) with any per-machine override (firebaseConfigLocal.ts)
 * merged on top. A non-empty local field wins; otherwise the injected value is
 * used unchanged.
 *
 * This is the single seam that lets a local iOS build (which CI's secret injection
 * never touches) run Firebase without committing keys — see firebaseConfigLocal.ts.
 * Everything that needs Firebase config imports from HERE, not from firebaseConfig.ts,
 * so both build paths resolve to the same place.
 */
import { firebaseConfig as injected, type FirebaseWebConfig } from './firebaseConfig';
import { firebaseConfigLocal } from './firebaseConfigLocal';

function nonEmpty(o: Partial<FirebaseWebConfig>): Partial<FirebaseWebConfig> {
  const out: Partial<FirebaseWebConfig> = {};
  (Object.keys(o) as (keyof FirebaseWebConfig)[]).forEach((k) => {
    const v = o[k];
    if (typeof v === 'string' && v !== '') out[k] = v;
  });
  return out;
}

export const resolvedFirebaseConfig: FirebaseWebConfig = { ...injected, ...nonEmpty(firebaseConfigLocal) };

/** True once a usable config is present (from CI injection OR the local override). */
export function isFirebaseConfigured(): boolean {
  return resolvedFirebaseConfig.apiKey !== '' && resolvedFirebaseConfig.projectId !== '';
}
