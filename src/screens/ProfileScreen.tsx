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
import { View, Text, TextInput, Pressable, Image, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { launchCamera, launchImageLibrary, type Asset } from 'react-native-image-picker';
import { useStore } from '../state/store';
import { VISIBILITY_OPTIONS, type Visibility } from '../discovery/visibility';
import { saveProfile, uploadProfilePhoto, ensureSignedIn, getLastAuthError } from '../lib/profiles';
import { setPendingProfileSync } from '../profiles/pendingSync';
import { saveMyProfileLocal } from '../identity/persistentId';
import { CATALOGS, catalogInterests, MAX_INTERESTS } from '../discovery/interests';

/**
 * Turn the real Firestore/auth error codes into a targeted, honest hint. We only
 * name a specific cause when the code points there — no more blanket "enable
 * Anonymous sign-in" when it's already on. The backend is optional, so every hint
 * ends by reassuring that identity still reaches nearby peers over Bluetooth.
 */
function authHintFor(code: string | null, authErr: string | null, signedIn: boolean): string {
  const overGatt = 'Your name and photo still reach nearby people over Bluetooth — you can continue.';
  const c = `${code ?? ''} ${authErr ?? ''}`;
  if (/admin-restricted-operation|configuration-not-found/.test(c)) {
    return `Anonymous sign-in looks disabled for this project (Authentication → Sign-in method). ${overGatt}`;
  }
  if (/too-many-requests/.test(c)) {
    return `Firebase is rate-limiting new anonymous sessions on this device; try again in a bit. ${overGatt}`;
  }
  if (/network-request-failed|unavailable|deadline-exceeded/.test(c)) {
    return `Looks like a network problem reaching Firebase. ${overGatt}`;
  }
  if (/permission-denied/.test(c)) {
    return `Firestore rules rejected the write${signedIn ? '' : ' (not signed in)'}. ${overGatt}`;
  }
  return overGatt;
}

export function ProfileScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const localPeerId = useStore((s) => s.localPeerId);
  const myName = useStore((s) => s.myName);
  const myPhotoURL = useStore((s) => s.myPhotoURL);
  const myPhotoThumb = useStore((s) => s.myPhotoThumb);
  const myInterests = useStore((s) => s.myInterests);
  const myHeadline = useStore((s) => s.myHeadline);
  const storedVisibility = useStore((s) => s.visibility);
  const storedCatalogId = useStore((s) => s.activeCatalogId);
  const setMyProfile = useStore((s) => s.setMyProfile);
  const setMyPhotoThumb = useStore((s) => s.setMyPhotoThumb);
  const setMyDiscovery = useStore((s) => s.setMyDiscovery);
  const setVisibility = useStore((s) => s.setVisibility);
  const setActiveCatalog = useStore((s) => s.setActiveCatalog);
  const setProfileSyncPending = useStore((s) => s.setProfileSyncPending);

  const [name, setName] = useState(myName ?? '');
  const [photoURL, setPhotoURL] = useState(myPhotoURL ?? '');
  // A locally-picked image (camera/gallery) not yet uploaded. Takes priority over
  // the pasted URL until saved.
  const [localUri, setLocalUri] = useState<string | null>(null);
  // A small base64 thumbnail of the picked image, sent to peers over GATT
  // (works even when the Firebase upload fails, e.g. on iOS).
  const [photoB64, setPhotoB64] = useState<string | null>(myPhotoThumb ?? null);
  // Discovery: the active catalog (per-event), selected interest ids (selection
  // order preserved — the FIRST is the primary, whose bucket rides the wire),
  // headline, and the looking-to-meet switch.
  const [catalogId, setCatalogId] = useState(storedCatalogId);
  const [interests, setInterests] = useState<string[]>(myInterests);
  const [headline, setHeadline] = useState(myHeadline ?? '');
  const [visibility, setVis] = useState<Visibility>(storedVisibility);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // First-ever setup (no name/photo saved yet). On first run we ask for a photo so
  // it gets captured and saved to the cloud; returning users are never blocked.
  const [firstSetup] = useState(() => !myName && !myPhotoURL && !myPhotoThumb);

  const catalogTags = catalogInterests(catalogId);
  const toggleInterest = (id: string): void => {
    setInterests((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_INTERESTS) return prev; // cap reached — ignore
      return [...prev, id];
    });
  };
  const pickCatalog = (id: string): void => {
    if (id === catalogId) return;
    setCatalogId(id);
    // Drop selections that don't belong to the new catalog (ids are disjoint).
    const valid = new Set(catalogInterests(id).map((i) => i.id));
    setInterests((prev) => prev.filter((x) => valid.has(x)));
  };
  const primaryInterest = interests[0] ?? null;

  const trimmedPhoto = photoURL.trim();
  const previewUri = localUri ?? (/^https?:\/\//i.test(trimmedPhoto) ? trimmedPhoto : null);
  const hasPhoto = !!previewUri || !!photoB64;
  // On the very first setup we require a photo before "Save & continue" (Skip is
  // still available); after that it's optional.
  const needsPhoto = firstSetup && !hasPhoto;

  const pick = (asset: Asset | undefined): void => {
    if (asset?.uri) {
      setLocalUri(asset.uri);
      if (asset.base64) setPhotoB64(asset.base64); // small thumbnail for GATT
      setError(null);
    }
  };

  // 128px / q0.5 keeps the base64 thumbnail tiny (~4–8 KB) so the multi-frame
  // GATT photo transfer completes reliably; it's still crisp for the avatar/card
  // (rendered at 72px). includeBase64 returns those bytes.
  const PICK_OPTS = { mediaType: 'photo' as const, quality: 0.5, maxWidth: 128, maxHeight: 128, includeBase64: true };

  const takeSelfie = async (): Promise<void> => {
    try {
      const res = await launchCamera({ ...PICK_OPTS, cameraType: 'front', saveToPhotos: false });
      if (!res.didCancel && !res.errorCode) pick(res.assets?.[0]);
    } catch {
      /* camera unavailable/denied — ignore */
    }
  };

  const chooseFromGallery = async (): Promise<void> => {
    try {
      const res = await launchImageLibrary({ ...PICK_OPTS, selectionLimit: 1 });
      if (!res.didCancel && !res.errorCode) pick(res.assets?.[0]);
    } catch {
      /* picker unavailable — ignore */
    }
  };

  const onSave = async (): Promise<void> => {
    if (saving || needsPhoto) return;
    setSaving(true);
    setError(null);
    const finalName = name.trim();

    // Whether anonymous auth actually signed us in. If not, cloud writes are denied
    // (rules require auth). We don't assume WHY here — the real code is reported
    // below (getLastAuthError) so the cause is diagnosable rather than guessed.
    const signedIn = await ensureSignedIn();

    // Resolve the photo, but NEVER let a photo failure block saving the name. A
    // deferred (offline) result is not an error — it means "will upload later".
    let finalPhoto: string | null = trimmedPhoto || null;
    let photoError: string | null = null;
    let photoDeferred = false;
    if (localUri) {
      const res = await uploadProfilePhoto(localPeerId, localUri);
      if (res.url) finalPhoto = res.url;
      else if (res.deferred) photoDeferred = true;
      else photoError = res.error ?? 'upload-failed';
    }

    const finalHeadline = headline.trim() || null;
    setMyProfile(finalName || null, finalPhoto);
    setMyPhotoThumb(photoB64);
    setMyDiscovery(interests, primaryInterest, finalHeadline);
    setActiveCatalog(catalogId);
    setVisibility(visibility);
    await saveMyProfileLocal({
      name: finalName || null,
      photoURL: finalPhoto,
      photoThumb: photoB64,
      interests,
      primaryInterest,
      headline: finalHeadline,
      activeCatalogId: catalogId,
      visibility,
    });
    let nameErr: string | null = null;
    let nameDeferred = false;
    // Persist interests/headline to the backend too (only meaningful with a name,
    // since the profile doc is keyed to a named identity peers can look up).
    if (finalName) {
      const res = await saveProfile(localPeerId, {
        name: finalName,
        photoURL: finalPhoto,
        ...(interests.length ? { interests } : {}),
        ...(finalHeadline ? { headline: finalHeadline } : {}),
      });
      if (!res.ok) {
        if (res.deferred) nameDeferred = true;
        else nameErr = res.error ?? 'write-failed';
      }
    }
    setSaving(false);

    // Offline: the local save already succeeded above. Stash what still needs to
    // reach the cloud and let the background sync flush it when connectivity
    // returns — never hang the UI waiting on a write that can't complete now.
    if ((nameDeferred || photoDeferred) && finalName) {
      await setPendingProfileSync({
        peerId: localPeerId,
        name: finalName,
        interests,
        headline: finalHeadline,
        photoURL: finalPhoto && /^https?:\/\//i.test(finalPhoto) ? finalPhoto : null,
        photoLocalUri: photoDeferred ? localUri : null,
        ts: Date.now(),
      });
      setProfileSyncPending(true);
    }

    if (photoError || nameErr) {
      // Report the REAL codes — the Firestore write error and the anonymous-auth
      // error — instead of guessing. `authHint` only names the provider when the
      // code actually points there; over-photos still show over GATT regardless.
      const authErr = getLastAuthError();
      const parts: string[] = [];
      parts.push(nameErr ? `Name save failed (${nameErr}).` : 'Name saved.');
      if (photoError) parts.push(`Photo upload failed (${photoError}).`);
      if (!signedIn) parts.push(`Firebase sign-in failed${authErr ? ` (${authErr})` : ''}.`);
      parts.push(authHintFor(nameErr ?? photoError, authErr, signedIn));
      setError(parts.filter(Boolean).join(' ').trim());
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
        {needsPhoto ? (
          <Text style={styles.hint}>A photo helps people recognise you when you bridge. Add one to continue — or skip below.</Text>
        ) : null}

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

        {CATALOGS.length > 1 ? (
          <>
            <Text style={styles.label}>Interest set</Text>
            <Text style={styles.hint}>Pick the set that matches where you are. You’ll match with people using the same one.</Text>
            <View style={styles.chips}>
              {CATALOGS.map((c) => {
                const on = c.id === catalogId;
                return (
                  <Pressable key={c.id} onPress={() => pickCatalog(c.id)} style={[styles.chip, on ? styles.chipOn : null]} disabled={saving}>
                    <Text style={[styles.chipText, on ? styles.chipTextOn : null]}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>Interests</Text>
        <Text style={styles.hint}>
          Pick up to {MAX_INTERESTS}. Your first pick (★) is your headline interest. These help us
          suggest people nearby you should meet.
        </Text>
        <View style={styles.chips}>
          {catalogTags.map((i) => {
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

        <Text style={styles.label}>Discovery</Text>
        <Text style={styles.hint}>
          Choose how you show up to people nearby. You can change this any time from the ✨ Nearby
          button.
        </Text>
        {VISIBILITY_OPTIONS.map((o) => {
          const on = o.mode === visibility;
          return (
            <Pressable
              key={o.mode}
              onPress={() => setVis(o.mode)}
              style={[styles.visRow, on ? styles.visRowOn : null]}
              disabled={saving}
            >
              <Text style={styles.visRadio}>{on ? '◉' : '○'}</Text>
              <View style={styles.visText}>
                <Text style={styles.visTitle}>
                  {o.emoji} {o.label}
                </Text>
                <Text style={styles.visDesc}>{o.desc}</Text>
              </View>
            </Pressable>
          );
        })}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.button, (saving || needsPhoto) && styles.buttonDisabled]}
          onPress={() => void onSave()}
          disabled={saving || needsPhoto}
        >
          {saving ? (
            <ActivityIndicator color="#04203a" />
          ) : (
            <Text style={styles.buttonText}>{needsPhoto ? 'Add a photo to continue' : 'Save & continue'}</Text>
          )}
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
  visRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(6,10,26,0.55)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(124,249,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  visRowOn: { borderColor: '#7cf9ff', backgroundColor: 'rgba(124,249,255,0.1)' },
  visRadio: { color: '#7cf9ff', fontSize: 18, width: 24, marginTop: 1 },
  visText: { flex: 1 },
  visTitle: { color: '#e6f1ff', fontSize: 15, fontWeight: '700' },
  visDesc: { color: '#7f92aa', fontSize: 12, lineHeight: 17, marginTop: 3 },
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
