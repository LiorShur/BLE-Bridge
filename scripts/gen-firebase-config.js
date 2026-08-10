#!/usr/bin/env node
/**
 * Generate src/lib/firebaseConfig.ts from FIREBASE_* env vars (CI injects these
 * from repo secrets). Kept as a committed script — NOT an inline heredoc in the
 * workflow YAML — because a multi-line template at column 0 breaks the YAML block
 * scalar. Empty/missing env → empty strings → the profile feature stays disabled.
 *
 * Usage: node scripts/gen-firebase-config.js [outPath]
 *   outPath defaults to src/lib/firebaseConfig.ts
 */
const fs = require('fs');
const path = require('path');

const outPath = process.argv[2] || 'src/lib/firebaseConfig.ts';
const s = (v) => JSON.stringify(v || '');

const body = `/* GENERATED — do not edit. Source: repo secrets via scripts/gen-firebase-config.js */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  appId: string;
}

export const firebaseConfig: FirebaseWebConfig = {
  apiKey: ${s(process.env.FIREBASE_API_KEY)},
  authDomain: ${s(process.env.FIREBASE_AUTH_DOMAIN)},
  projectId: ${s(process.env.FIREBASE_PROJECT_ID)},
  storageBucket: ${s(process.env.FIREBASE_STORAGE_BUCKET)},
  appId: ${s(process.env.FIREBASE_APP_ID)},
};

export function isFirebaseConfigured(): boolean {
  return firebaseConfig.apiKey !== '' && firebaseConfig.projectId !== '';
}
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, body);
// Log only whether it's populated — never the values.
const populated = (process.env.FIREBASE_API_KEY || '') !== '' && (process.env.FIREBASE_PROJECT_ID || '') !== '';
console.log(`Wrote ${outPath} (firebase ${populated ? 'configured' : 'disabled — empty secrets'})`);
