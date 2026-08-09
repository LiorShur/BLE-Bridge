/**
 * Onboarding (TASKS.md P4-5): two sentences, no tutorial.
 *
 * Stage 1 copy is proximity-only (no compass/"face each other" gate yet — that
 * returns with AR in Stage 2).
 *
 * NOTE: depends on React Native; not testable off-device.
 */
import React from 'react';
import { MessageScreen } from './MessageScreen';

export function OnboardingScreen({ onStart }: { onStart: () => void }): React.ReactElement {
  return (
    <MessageScreen
      title="AuraBridge"
      body={'Find someone else running the app and walk toward them. A bridge of light forms between you as you get close.'}
      actionLabel="Begin"
      onAction={onStart}
    />
  );
}
