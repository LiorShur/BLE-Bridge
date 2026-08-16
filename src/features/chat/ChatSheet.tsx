/**
 * Chat sheet — the Tier 2 messaging UI (docs/GATT_MESSAGING_SPEC.md §5, M3).
 *
 * Opens for one peer (store.chatPeerId). Shows the per-peer history and a compose
 * box; sending calls store.sendChat, which shows the line optimistically and hands
 * it to the GATT transport. Inbound text arrives via useBondEngine → pushChatMessage.
 *
 * Messaging needs a GATT connection. It works across all pairings — iPhone↔Android,
 * iPhone↔iPhone, and Android↔Android (the last opens a dedicated GATT link between
 * two bonded Androids; see useBondEngine + GATT_MESSAGING_SPEC). The bond/beam stays
 * connectionless; only the message channel uses a connection.
 *
 * NOTE: depends on React Native; not part of the pure-logic test suite.
 */
import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useStore } from '../../state/store';
import { hueByteToHex } from '../../ar/effects';
import { shortPeerTag } from '../../ui/peerLabel';

export function ChatSheet(): React.ReactElement | null {
  const peerId = useStore((s) => s.chatPeerId);
  const setChatPeer = useStore((s) => s.setChatPeer);
  const sendChat = useStore((s) => s.sendChat);
  const chats = useStore((s) => s.chats);
  const profiles = useStore((s) => s.profiles);

  const [draft, setDraft] = React.useState('');
  const scrollRef = useRef<ScrollView>(null);
  const messages = peerId != null ? (chats[peerId >>> 0] ?? []) : [];

  useEffect(() => {
    // Scroll to the newest line whenever the count changes.
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages.length]);

  if (peerId == null) return null;

  const hue = hueByteToHex(peerId & 0xff);
  const prof = profiles[peerId >>> 0];
  const name = prof?.status === 'loaded' && prof.name ? prof.name : shortPeerTag(peerId);
  const close = (): void => setChatPeer(null);

  const onSend = (): void => {
    const t = draft.trim();
    if (!t) return;
    sendChat(peerId, t);
    setDraft('');
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={[styles.dot, { backgroundColor: hue }]} />
            <Text style={styles.title} numberOfLines={1}>
              {name}
            </Text>
            <Pressable style={styles.closeBtn} onPress={close}>
              <Text style={styles.closeTxt}>✕</Text>
            </Pressable>
          </View>

          <ScrollView ref={scrollRef} style={styles.list} contentContainerStyle={styles.listContent}>
            {messages.length === 0 ? (
              <Text style={styles.empty}>
                Say hi 👋{'\n'}Messages send directly, phone-to-phone — no internet, once you’re
                bonded and connected.
              </Text>
            ) : (
              messages.map((m) => (
                <View key={m.key} style={[styles.bubbleRow, m.from === 'me' ? styles.rowMe : styles.rowThem]}>
                  <View style={[styles.bubble, m.from === 'me' ? { backgroundColor: hue } : styles.bubbleThem]}>
                    <Text style={[styles.bubbleText, m.from === 'me' ? styles.bubbleTextMe : null]}>{m.text}</Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Message…"
              placeholderTextColor="#5b6b82"
              multiline
              maxLength={500}
              onSubmitEditing={onSend}
              returnKeyType="send"
              blurOnSubmit
            />
            <Pressable style={[styles.sendBtn, { backgroundColor: hue }]} onPress={onSend}>
              <Text style={styles.sendTxt}>Send</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(2,4,12,0.6)' },
  sheet: {
    maxHeight: '82%',
    minHeight: '55%',
    backgroundColor: 'rgba(10,15,32,0.99)',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: 'rgba(124,249,255,0.2)',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, paddingHorizontal: 2 },
  dot: { width: 12, height: 12, borderRadius: 6, marginRight: 9 },
  title: { flex: 1, color: '#e6f1ff', fontSize: 18, fontWeight: '800' },
  closeBtn: { padding: 6 },
  closeTxt: { color: '#9fb3c8', fontSize: 20, fontWeight: '700' },
  list: { flex: 1 },
  listContent: { paddingVertical: 8 },
  empty: { color: '#8aa0bd', fontSize: 14, lineHeight: 21, textAlign: 'center', paddingVertical: 30, paddingHorizontal: 12 },
  bubbleRow: { flexDirection: 'row', marginVertical: 3 },
  rowMe: { justifyContent: 'flex-end' },
  rowThem: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 8 },
  bubbleThem: { backgroundColor: 'rgba(124,249,255,0.12)' },
  bubbleText: { color: '#e6f1ff', fontSize: 15, lineHeight: 20 },
  bubbleTextMe: { color: '#04203a', fontWeight: '600' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 6 },
  input: {
    flex: 1,
    backgroundColor: 'rgba(6,10,26,0.8)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(124,249,255,0.25)',
    color: '#e6f1ff',
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 15,
    maxHeight: 110,
  },
  sendBtn: { marginLeft: 8, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 11 },
  sendTxt: { color: '#04203a', fontSize: 15, fontWeight: '800' },
});
