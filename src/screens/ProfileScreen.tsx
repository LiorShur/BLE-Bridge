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
import { View, Text, TextInput, Pressable, Image, Switch, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { launchCamera, launchImageLibrary, type Asset } from 'react-native-image-picker';
import { useStore } from '../state/store';
import { saveProfile, uploadProfilePhoto, ensureSignedIn } from '../lib/profiles';
import { saveMyProfileLocal } from '../identity/persistentId';
import { INTERESTS, MAX_INTERESTS } from '../discovery/interests';

export function ProfileScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const localPeerId = useStore((s) => s.localPeerId);
  const myName = useStore((s) => s.myName);
  const myPhotoURL = useStore((s) => s.myPhotoURL);
  const myInterests = useStore((s) => s.myInterests);
  const myHeadline = useStore((s) => s.myHeadline);
  const storedLooking = useStore((s) => s.lookingToMeet);
  const setMyProfile = useStore((s) => s.setMyProfile);
  const setMyDiscovery = useStore((s) => s.setMyDiscovery);
  const setLookingToMeet = useStore((s) => s.setLookingToMeet);

  const [name, setName] = useState(myName ?? '');
  const [photoURL, setPhotoURL] = useState(myPhotoURL ?? '');
  // A locally-picked image (camera/gallery) not yet uploaded. Takes priority over
  // the pasted URL until saved.
  const [localUri, setLocalUri] = useState<string | null>(null);
  // Discovery: selected interest ids (selection order preserved — the FIRST is the
  // primary, whose bucket rides the wire), headline, and the looking-to-meet switch.
  const [interests, setInterests] = useState<string[]>(myInterests);
  const [headline, setHeadline] = useState(myHeadline ?? '');
  const [looking, setLooking] = useState(storedLooking);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleInterest = (id: string): void => {
    setInterests((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_INTERESTS) return prev; // cap reached — ignore
      return [...prev, id];
    });
  };
  const primaryInterest = interests[0] ?? null;

  const trimmedPhoto = photoURL.trim();
  const previewUri = localUri ?? (/^https?:\/\//i.test(trimmedPhoto) ? trimmedPhoto : null);

  const pick = (asset: Asset | undefined): void => {
    if (asset?.uri) {
      setLocalUri(asset.uri);
      setError(null);
    }
  };

  const takeSelfie = async (): Promise<void> => {
    try {
      const res = await launchCamera({ mediaType: 'photo', cameraType: 'front', quality: 0.6, maxWidth: 512, maxHeight: 512, saveToPhotos: false });
      if (!res.didCancel && !res.errorCode) pick(res.assets?.[0]);
    } catch {
      /* camera unavailable/denied — ignore */
    }
  };

  const chooseFromGallery = async (): Promise<void> => {
    try {
      const res = await launchImageLibrary({ mediaType: 'photo', quality: 0.6, maxWidth: 512, maxHeight: 512, selectionLimit: 1 });
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

    // Whether anonymous auth actually signed us in. If not, every cloud write is
    // denied (rules require auth) — the usual cause is the Anonymous provider
    // being disabled in Firebase. Surfacing this makes the failure diagnosable.
    const signedIn = await ensureSignedIn();

    // Resolve the photo, but NEVER let a photo failure block saving the name.
    let finalPhoto: string | null = trimmedPhoto || null;
    let photoError: string | null = null;
    if (localUri) {
      const res = await uploadProfilePhoto(localPeerId, localUri);
      if (res.url) finalPhoto = res.url;
      else photoError = res.error ?? 'upload-failed';
    }

    const finalHeadline = headline.trim() || null;
    setMyProfile(finalName || null, finalPhoto);
    setMyDiscovery(interests, primaryInterest, finalHeadline);
    setLookingToMeet(looking);
    await saveMyProfileLocal({
      name: finalName || null,
      photoURL: finalPhoto,
      interests,
      primaryInterest,
      headline: finalHeadline,
    });
    let nameOk = true;
    // Persist interests/headline to the backend too (only meaningful with a name,
    // since the profile doc is keyed to a named identity peers can look up).
    if (finalName) {
      nameOk = await saveProfile(localPeerId, {
        name: finalName,
        photoURL: finalPhoto,
        ...(interests.length ? { interests } : {}),
        ...(finalHeadline ? { headline: finalHeadline } : {}),
      });
    }
    setSaving(false);

    if (photoError || !nameOk) {
      const hint = !signedIn
        ? ' Not signed in to Firebase — enable Anonymous sign-in (Authentication → Sign-in method).'
        : '';
      const parts: string[] = [];
      if (!nameOk) parts.push('Name save failed.');
      else parts.push('Name saved.');
      if (photoError) parts.push(`Photo upload failed (${photoError}).`);
      setError(`${parts.join(' ')}${hint} Retry or continue.`);
      return;
    }
    if (finalPhoto) {
      setPhotoURL(finalPhoto);
      setLocalUri(null);
    }
    onDone();
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
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

        <Text style={styles.label}>Interests</Text>
        <Text style={styles.hint}>
          Pick up to {MAX_INTERESTS}. Your first pick (★) is your headline interest. These help us
          suggest people nearby you should meet.
        </Text>
        <View style={styles.chips}>
          {INTERESTS.map((i) => {
            const idx = interests.indexOf(i.id);
            const selected = idx >= 0;
            const isPrimary = idx === 0;
            return (
              <Pressable
                key={i.id}
                onPress={() => toggleInterest(i.id)}
                style={[styles.chip, selected ? styles.chipOn : null]}
                disabled={saving}
              >
                <Text style={[styles.chipText, selected ? styles.chipTextOn : null]}>
                  {isPrimary ? '★ ' : ''}
                  {i.emoji} {i.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Headline</Text>
        <TextInput
          style={styles.input}
          value={headline}
          onChangeText={setHeadline}
          placeholder="e.g. building a BLE toy"
          placeholderTextColor="#5b6b82"
          maxLength={60}
          returnKeyType="done"
        />

        <View style={styles.lookingRow}>
          <View style={styles.lookingText}>
            <Text style={styles.lookingTitle}>Looking to meet</Text>
            <Text style={styles.hint}>
              Broadcast that you’re open to meeting nearby people. You appear to others only while
              this is on — and you can toggle it any time from the ✨ Nearby button.
            </Text>
          </View>
          <Switch
            value={looking}
            onValueChange={setLooking}
            trackColor={{ false: '#2a3550', true: '#2f7d8a' }}
            thumbColor={looking ? '#7cf9ff' : '#8aa0bd'}
            disabled={saving}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={[styles.button, saving && styles.buttonDisabled]} onPress={() => void onSave()}>
          {saving ? <ActivityIndicator color="#04203a" /> : <Text style={styles.buttonText}>Save & continue</Text>}
        </Pressable>
        <Pressable style={styles.skip} onPress={onDone} disabled={saving}>
          <Text style={styles.skipText}>{error ? 'Continue anyway' : 'Skip for now'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#060a1a' },
  container: { alignItems: 'center', justifyContent: 'center', padding: 24, flexGrow: 1 },
  card: { width: '100%', maxWidth: 420, backgroundColor: 'rgba(18,26,52,0.9)', borderRadius: 16, padding: 24 },
  title: { color: '#e6f1ff', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  body: { color: '#9fb3c8', fontSize: 15, lineHeight: 22, marginBottom: 16 },
  label: { color: '#7cf9ff', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginTop: 12, marginBottom: 6 },
  hint: { color: '#7f92aa', fontSize: 12, lineHeight: 17, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    backgroundColor: 'rgba(6,10,26,0.7)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(124,249,255,0.2)',
    paddingHorizontal: 11,
    paddingVertical: 7,
    marginRight: 7,
    marginBottom: 7,
  },
  chipOn: { backgroundColor: 'rgba(124,249,255,0.16)', borderColor: '#7cf9ff' },
  chipText: { color: '#9fb3c8', fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: '#e6f1ff' },
  lookingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  lookingText: { flex: 1, paddingRight: 12 },
  lookingTitle: { color: '#e6f1ff', fontSize: 15, fontWeight: '700', marginBottom: 4 },
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
