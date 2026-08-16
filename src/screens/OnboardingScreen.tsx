/**
 * Onboarding (TASKS.md P4-5): two sentences, no tutorial.
 *
 * NOTE: depends on React Native; not testable off-device.
 */
import React from 'react';
import { MessageScreen } from './MessageScreen';

export function OnboardingScreen({ onStart }: { onStart: () => void }): React.ReactElement {
  return (
    <MessageScreen
      title="AuraBridge"
      body={'Find someone else running the app and stand close. Turn to face each other, and hold your phone up between you.'}
      actionLabel="Begin"
      onAction={onStart}
    />
  );
}
