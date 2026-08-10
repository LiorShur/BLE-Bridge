/**
 * Profile setup: the local user sets the display name (and, optionally, a photo
 * URL) that peers will see on the bridge once they bond. Writes to the profile
 * backend under this device's persistent peerId and mirrors it locally.
 *
 * Photo is a pasted URL for now (zero native deps); a gallery picker + upload is
 * the planned #2b follow-up. Skipping is always allowed — the app is fully usable
 * anonymously, so this screen never blocks entry.
 *
 * NOTE: depends on React Native; not testable off-device.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { useStore } from '../state/store';
import { saveProfile } from '../lib/profiles';
import { saveMyProfileLocal } from '../identity/persistentId';

export function ProfileScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const localPeerId = useStore((s) => s.localPeerId);
  const myName = useStore((s) => s.myName);
  const myPhotoURL = useStore((s) => s.myPhotoURL);
  const setMyProfile = useStore((s) => s.setMyProfile);

  const [name, setName] = useState(myName ?? '');
  const [photoURL, setPhotoURL] = useState(myPhotoURL ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedPhoto = photoURL.trim();
  const showPreview = /^https?:\/\//i.test(trimmedPhoto);

  const onSave = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const finalName = name.trim();
    const finalPhoto = trimmedPhoto || null;
    // Local mirror always succeeds; the network write is what can fail.
    setMyProfile(finalName || null, finalPhoto);
    await saveMyProfileLocal({ name: finalName || null, photoURL: finalPhoto });
    let ok = true;
    if (finalName) ok = await saveProfile(localPeerId, { name: finalName, photoURL: finalPhoto });
    setSaving(false);
    if (!ok) {
      // Keep the user here so they know the cloud save didn't land — otherwise a
      // silent failure looks identical to "it worked".
      setError("Couldn't save to the cloud — your name may not reach peers. Check connection and retry, or continue anyway.");
      return;
    }
    onDone();
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Your aura</Text>
        <Text style={styles.body}>
          Set a name so people you bridge with know it's you. You can skip this and stay anonymous.
        </Text>

        <Text style={styles.label}>Display name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Lior"
          placeholderTextColor="#5b6b82"
          maxLength={24}
          autoCapitalize="words"
          returnKeyType="done"
        />

        <Text style={styles.label}>Photo URL (optional)</Text>
        <TextInput
          style={styles.input}
          value={photoURL}
          onChangeText={setPhotoURL}
          placeholder="https://…"
          placeholderTextColor="#5b6b82"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
        />
        {showPreview ? <Image source={{ uri: trimmedPhoto }} style={styles.preview} /> : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={[styles.button, saving && styles.buttonDisabled]} onPress={() => void onSave()}>
          {saving ? <ActivityIndicator color="#04203a" /> : <Text style={styles.buttonText}>Save & continue</Text>}
        </Pressable>
        <Pressable style={styles.skip} onPress={onDone} disabled={saving}>
          <Text style={styles.skipText}>{error ? 'Continue anyway' : 'Skip for now'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060a1a', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, backgroundColor: 'rgba(18,26,52,0.9)', borderRadius: 16, padding: 24 },
  title: { color: '#e6f1ff', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  body: { color: '#9fb3c8', fontSize: 15, lineHeight: 22, marginBottom: 16 },
  label: { color: '#7cf9ff', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: 'rgba(6,10,26,0.7)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(124,249,255,0.25)',
    color: '#e6f1ff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  preview: { width: 64, height: 64, borderRadius: 32, marginTop: 12, alignSelf: 'center', backgroundColor: '#0d1530' },
  error: { color: '#ff9f9f', fontSize: 13, lineHeight: 19, marginTop: 14 },
  button: { marginTop: 22, backgroundColor: '#7cf9ff', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#04203a', fontSize: 16, fontWeight: '700' },
  skip: { marginTop: 12, alignItems: 'center', paddingVertical: 8 },
  skipText: { color: '#9fb3c8', fontSize: 14 },
});
