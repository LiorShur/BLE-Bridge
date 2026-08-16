/**
 * Full-screen message with optional action — the shell for every failure state
 * (TASKS.md P4-7) and the capability/onboarding screens. Dark theme per concept.
 *
 * NOTE: depends on React Native; not testable off-device.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

export interface MessageScreenProps {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: React.ReactNode;
}

export function MessageScreen({ title, body, actionLabel, onAction, children }: MessageScreenProps): React.ReactElement {
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        {body ? <Text style={styles.body}>{body}</Text> : null}
        {children}
        {actionLabel && onAction ? (
          <Pressable style={styles.button} onPress={onAction}>
            <Text style={styles.buttonText}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060a1a', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, backgroundColor: 'rgba(18,26,52,0.9)', borderRadius: 16, padding: 24 },
  title: { color: '#e6f1ff', fontSize: 22, fontWeight: '700', marginBottom: 12 },
  body: { color: '#9fb3c8', fontSize: 15, lineHeight: 22 },
  button: { marginTop: 20, backgroundColor: '#7cf9ff', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#04203a', fontSize: 16, fontWeight: '700' },
});
