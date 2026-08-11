/**
 * Profile setup: the local user sets the display name and photo that peers will
 * see on the bridge once they bond. Writes to the profile backend under this
 * device's persistent peerId and mirrors it locally.
 *
 * Photo sources: take a selfie (front camera), pick from the gallery, or paste a
 * URL. A camera/gallery pick is uploaded to Storage on save and its download URL
 * becomes the photoURL. Skipping is always allowed — the app is fully usable
 * anonymously, so this screen never blocks entry.
 *
 * NOTE: depends on React Native; not testable off-device.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { launchCamera, launchImageLibrary, type Asset } from 'react-native-image-picker';
import { useStore } from '../state/store';
import { saveProfile, uploadProfilePhoto } from '../lib/profiles';
import { saveMyProfileLocal } from '../identity/persistentId';

export function ProfileScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const localPeerId = useStore((s) => s.localPeerId);
  const myName = useStore((s) => s.myName);
  const myPhotoURL = useStore((s) => s.myPhotoURL);
  const setMyProfile = useStore((s) => s.setMyProfile);

  const [name, setName] = useState(myName ?? '');
  const [photoURL, setPhotoURL] = useState(myPhotoURL ?? '');
  // A locally-picked image (camera/gallery) not yet uploaded: uri for preview,
  // base64 for the upload. Takes priority over the pasted URL until saved.
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [localBase64, setLocalBase64] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedPhoto = photoURL.trim();
  const previewUri = localUri ?? (/^https?:\/\//i.test(trimmedPhoto) ? trimmedPhoto : null);

  const pick = (asset: Asset | undefined): void => {
    if (asset?.uri) {
      setLocalUri(asset.uri);
      setLocalBase64(asset.base64 ?? null);
      setError(null);
    }
  };

  const takeSelfie = async (): Promise<void> => {
    try {
      const res = await launchCamera({ mediaType: 'photo', cameraType: 'front', quality: 0.6, maxWidth: 512, maxHeight: 512, includeBase64: true, saveToPhotos: false });
      if (!res.didCancel && !res.errorCode) pick(res.assets?.[0]);
    } catch {
      /* camera unavailable/denied — ignore */
    }
  };

  const chooseFromGallery = async (): Promise<void> => {
    try {
      const res = await launchImageLibrary({ mediaType: 'photo', quality: 0.6, maxWidth: 512, maxHeight: 512, includeBase64: true, selectionLimit: 1 });
      if (!res.didCancel && !res.errorCode) pick(res.assets?.[0]);
    } catch {
      /* picker unavailable — ignore */
    }
  };

  const onSave = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const finalName = name.trim();

    // Resolve the photo, but NEVER let a photo failure block saving the name.
    let finalPhoto: string | null = trimmedPhoto || null;
    let photoError: string | null = null;
    if (localBase64) {
      const res = await uploadProfilePhoto(localPeerId, localBase64);
      if (res.url) finalPhoto = res.url;
      else photoError = res.error ?? 'upload-failed';
    }

    setMyProfile(finalName || null, finalPhoto);
    await saveMyProfileLocal({ name: finalName || null, photoURL: finalPhoto });
    let nameOk = true;
    if (finalName) nameOk = await saveProfile(localPeerId, { name: finalName, photoURL: finalPhoto });
    setSaving(false);

    if (photoError) {
      setError(`Photo upload failed (${photoError}). Your name was saved — retry the photo or continue without it.`);
      return;
    }
    if (!nameOk) {
      setError("Couldn't save your name to the cloud — check connection and retry, or continue anyway.");
      return;
    }
    if (finalPhoto) {
      setPhotoURL(finalPhoto);
      setLocalUri(null);
      setLocalBase64(null);
    }
    onDone();
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Your aura</Text>
        <Text style={styles.body}>
          Set a name and photo so people you bridge with know it's you. You can skip this and stay anonymous.
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

        <Text style={styles.label}>Photo</Text>
        {previewUri ? <Image source={{ uri: previewUri }} style={styles.preview} /> : <View style={styles.previewEmpty} />}
        <View style={styles.photoRow}>
          <Pressable style={styles.photoButton} onPress={() => void takeSelfie()} disabled={saving}>
            <Text style={styles.photoButtonText}>📷 Take selfie</Text>
          </Pressable>
          <Pressable style={styles.photoButton} onPress={() => void chooseFromGallery()} disabled={saving}>
            <Text style={styles.photoButtonText}>🖼 Gallery</Text>
          </Pressable>
        </View>

        <Text style={styles.labelSmall}>…or paste an image URL</Text>
        <TextInput
          style={styles.input}
          value={photoURL}
          onChangeText={(v) => {
            setPhotoURL(v);
            if (v) setLocalUri(null); // a typed URL supersedes a pending local pick
          }}
          placeholder="https://…"
          placeholderTextColor="#5b6b82"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
        />

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
  labelSmall: { color: '#5b6b82', fontSize: 11, marginTop: 12, marginBottom: 6 },
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
  preview: { width: 72, height: 72, borderRadius: 36, alignSelf: 'center', backgroundColor: '#0d1530', marginBottom: 10 },
  previewEmpty: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignSelf: 'center',
    backgroundColor: '#0d1530',
    borderWidth: 1,
    borderColor: 'rgba(124,249,255,0.15)',
    marginBottom: 10,
  },
  photoRow: { flexDirection: 'row', justifyContent: 'center' },
  photoButton: {
    backgroundColor: 'rgba(124,249,255,0.12)',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 6,
  },
  photoButtonText: { color: '#7cf9ff', fontSize: 14, fontWeight: '600' },
  error: { color: '#ff9f9f', fontSize: 13, lineHeight: 19, marginTop: 14 },
  button: { marginTop: 22, backgroundColor: '#7cf9ff', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#04203a', fontSize: 16, fontWeight: '700' },
  skip: { marginTop: 12, alignItems: 'center', paddingVertical: 8 },
  skipText: { color: '#9fb3c8', fontSize: 14 },
});
