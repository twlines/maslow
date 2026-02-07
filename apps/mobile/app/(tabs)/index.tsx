import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Animated,
  ScrollView,
} from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  connect, disconnect, sendChat, sendVoice, setCallbacks, api,
  type PresenceState,
} from "../../services/api";

const ACCENT = "#7C5CFC";
const BG = "#0F0F0F";
const SURFACE = "#1A1A1A";
const TEXT_PRIMARY = "#E5E5E5";
const TEXT_SECONDARY = "#999999";
const BORDER = "#333333";
const AI_THINKING = "#2D2044";
const RECORDING_RED = "#F87171";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  timestamp: number;
}

// Presence waveform — organic pulse showing Maslow's state
function PresenceWaveform({ state }: { state: PresenceState }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    let animation: Animated.CompositeAnimation;

    if (state === "idle") {
      animation = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(pulseAnim, { toValue: 1.1, duration: 3000, useNativeDriver: true }),
            Animated.timing(opacityAnim, { toValue: 0.6, duration: 3000, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(pulseAnim, { toValue: 1, duration: 3000, useNativeDriver: true }),
            Animated.timing(opacityAnim, { toValue: 0.4, duration: 3000, useNativeDriver: true }),
          ]),
        ])
      );
    } else if (state === "thinking") {
      animation = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(pulseAnim, { toValue: 1.3, duration: 800, useNativeDriver: true }),
            Animated.timing(opacityAnim, { toValue: 0.9, duration: 800, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
            Animated.timing(opacityAnim, { toValue: 0.5, duration: 800, useNativeDriver: true }),
          ]),
        ])
      );
    } else {
      animation = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(pulseAnim, { toValue: 1.2, duration: 400, useNativeDriver: true }),
            Animated.timing(opacityAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(pulseAnim, { toValue: 1.05, duration: 400, useNativeDriver: true }),
            Animated.timing(opacityAnim, { toValue: 0.7, duration: 400, useNativeDriver: true }),
          ]),
        ])
      );
    }

    animation.start();
    return () => animation.stop();
  }, [state, pulseAnim, opacityAnim]);

  const label = state === "idle" ? "Listening" : state === "thinking" ? "Thinking..." : "Speaking";

  return (
    <View style={styles.presenceContainer}>
      <Animated.View
        style={[
          styles.presenceOrb,
          { transform: [{ scale: pulseAnim }], opacity: opacityAnim },
        ]}
      />
      <Animated.View
        style={[
          styles.presenceOrbInner,
          { transform: [{ scale: pulseAnim }] },
        ]}
      />
      <Text style={styles.presenceLabel}>{label}</Text>
    </View>
  );
}

// Web-only: convert Blob to base64
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Strip the data URL prefix (data:audio/webm;base64,...)
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Web-only: play base64 OGG audio
function playAudioBase64(base64: string, format: string) {
  if (Platform.OS !== "web") return;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: `audio/${format === "ogg" ? "ogg" : "wav"}` });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.play().catch(console.error);
  audio.onended = () => URL.revokeObjectURL(url);
}

interface ProjectInfo {
  id: string;
  name: string;
}

export default function TalkScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [presence, setPresence] = useState<PresenceState>("idle");
  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeProject, setActiveProject] = useState<string | undefined>(undefined);
  const flatListRef = useRef<FlatList>(null);
  const streamingRef = useRef<Map<string, string>>(new Map());
  const mediaRecorderRef = useRef<any>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    setCallbacks({
      onStream: (content, messageId) => {
        const current = streamingRef.current.get(messageId) || "";
        const updated = current + content;
        streamingRef.current.set(messageId, updated);

        setMessages((prev) => {
          const existing = prev.find((m) => m.id === messageId);
          if (existing) {
            return prev.map((m) =>
              m.id === messageId ? { ...m, content: updated } : m
            );
          }
          return [
            ...prev,
            { id: messageId, role: "assistant", content: updated, streaming: true, timestamp: Date.now() },
          ];
        });
      },
      onComplete: (messageId, message) => {
        streamingRef.current.delete(messageId);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, content: message.content, streaming: false } : m
          )
        );
      },
      onTranscription: (messageId, text) => {
        // Show what the user said as a message
        setMessages((prev) => [
          ...prev,
          { id: messageId, role: "user", content: text, timestamp: Date.now() },
        ]);
      },
      onAudio: (_messageId, audioBase64, format) => {
        // Play Maslow's voice response
        if (Platform.OS === "web") {
          playAudioBase64(audioBase64, format);
        }
      },
      onError: (error) => {
        setMessages((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, role: "assistant", content: `Error: ${error}`, timestamp: Date.now() },
        ]);
      },
      onHandoff: (message) => {
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, role: "assistant", content: `[${message}]`, timestamp: Date.now() },
        ]);
      },
      onHandoffComplete: (_conversationId, message) => {
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, role: "assistant", content: `[${message}]`, timestamp: Date.now() },
        ]);
      },
      onPresence: (state) => setPresence(state),
      onOpen: () => setConnected(true),
      onClose: () => setConnected(false),
    });

    connect();

    // Fetch projects for thread selector
    api.getProjects().then((p) => setProjects(p.map((x: any) => ({ id: x.id, name: x.name })))).catch(() => {});

    // Load message history for General thread
    api.getMessages(undefined, 50, 0)
      .then((msgs: any[]) => {
        setMessages(
          msgs
            .map((m: any) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              timestamp: m.timestamp,
            }))
            .reverse()
        );
      })
      .catch(() => {});

    return () => disconnect();
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;

    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", content: text, timestamp: Date.now() },
    ]);
    sendChat(text, activeProject);
    setInput("");
  }, [input, activeProject]);

  const startRecording = useCallback(async () => {
    if (Platform.OS !== "web") return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });

      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event: any) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());

        try {
          const base64 = await blobToBase64(blob);
          sendVoice(base64, activeProject);
        } catch (err) {
          console.error("Failed to encode audio:", err);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
    } catch (err) {
      console.error("Mic access denied:", err);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      setRecording(false);
    }
  }, [recording]);

  const handleMicPress = useCallback(() => {
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [recording, startRecording, stopRecording]);

  // Load message history for a thread
  const loadHistory = useCallback((projectId?: string) => {
    api.getMessages(projectId, 50, 0)
      .then((msgs: any[]) => {
        setMessages(
          msgs
            .map((m: any) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              timestamp: m.timestamp,
            }))
            .reverse() // API returns DESC, display needs ASC
        );
      })
      .catch(() => setMessages([]));
  }, []);

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === "user";
    return (
      <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <Text style={[styles.messageText, isUser && styles.userMessageText]}>
          {item.content}
          {item.streaming && <Text style={styles.cursor}>|</Text>}
        </Text>
      </View>
    );
  };

  const showPresence = messages.length === 0;
  const showMic = !input.trim();

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.statusBar}>
        <View style={[styles.statusDot, connected ? styles.statusOnline : styles.statusOffline]} />
        <Text style={styles.statusText}>{connected ? "Connected" : "Reconnecting..."}</Text>
      </View>

      {projects.length > 0 && (
        <View style={styles.threadBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.threadScroll}>
            <Pressable
              onPress={() => { setActiveProject(undefined); loadHistory(); }}
              style={[styles.threadPill, !activeProject && styles.threadPillActive]}
            >
              <Text style={[styles.threadPillText, !activeProject && styles.threadPillTextActive]}>General</Text>
            </Pressable>
            {projects.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => { setActiveProject(p.id); loadHistory(p.id); }}
                style={[styles.threadPill, activeProject === p.id && styles.threadPillActive]}
              >
                <Text style={[styles.threadPillText, activeProject === p.id && styles.threadPillTextActive]}>{p.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {showPresence ? (
        <Pressable style={styles.presenceArea} onPress={handleMicPress}>
          <PresenceWaveform state={recording ? "speaking" : presence} />
          <Text style={styles.hintText}>
            {recording ? "Recording... tap to send" : "Tap to talk, or type below"}
          </Text>
        </Pressable>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          style={styles.messageList}
          contentContainerStyle={styles.messageListContent}
        />
      )}

      {!showPresence && presence === "thinking" && (
        <View style={styles.thinkingBar}>
          <Text style={styles.thinkingText}>Maslow is thinking...</Text>
        </View>
      )}

      {recording && !showPresence && (
        <View style={styles.recordingBar}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>Recording...</Text>
        </View>
      )}

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Message Maslow..."
          placeholderTextColor={TEXT_SECONDARY}
          multiline
          maxLength={10000}
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
          returnKeyType="send"
        />
        {showMic ? (
          <Pressable
            onPress={handleMicPress}
            style={({ pressed }) => [
              styles.micButton,
              recording && styles.micButtonRecording,
              pressed && styles.sendButtonPressed,
            ]}
          >
            <FontAwesome
              name={recording ? "stop" : "microphone"}
              size={18}
              color="#FFFFFF"
            />
          </Pressable>
        ) : (
          <Pressable
            onPress={handleSend}
            style={({ pressed }) => [
              styles.sendButton,
              pressed && styles.sendButtonPressed,
            ]}
          >
            <Text style={styles.sendButtonText}>Send</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: SURFACE,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statusOnline: { backgroundColor: "#34D399" },
  statusOffline: { backgroundColor: "#F87171" },
  statusText: { color: TEXT_SECONDARY, fontSize: 12 },
  threadBar: {
    backgroundColor: SURFACE,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    paddingVertical: 6,
  },
  threadScroll: { paddingHorizontal: 12, gap: 8 },
  threadPill: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  threadPillActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  threadPillText: { color: TEXT_SECONDARY, fontSize: 12, fontWeight: "500" },
  threadPillTextActive: { color: "#FFFFFF" },
  presenceArea: { flex: 1, justifyContent: "center", alignItems: "center" },
  presenceContainer: { alignItems: "center", justifyContent: "center", width: 200, height: 200 },
  presenceOrb: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: ACCENT,
  },
  presenceOrbInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: ACCENT },
  presenceLabel: { marginTop: 24, color: TEXT_SECONDARY, fontSize: 14, fontStyle: "italic" },
  hintText: { marginTop: 32, color: TEXT_SECONDARY, fontSize: 13 },
  messageList: { flex: 1 },
  messageListContent: { padding: 16, paddingBottom: 8 },
  messageBubble: { maxWidth: "80%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, marginBottom: 8 },
  userBubble: { backgroundColor: ACCENT, alignSelf: "flex-end", borderBottomRightRadius: 4 },
  assistantBubble: { backgroundColor: SURFACE, alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  messageText: { color: TEXT_PRIMARY, fontSize: 15, lineHeight: 21 },
  userMessageText: { color: "#FFFFFF" },
  cursor: { color: ACCENT, fontWeight: "300" },
  thinkingBar: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: AI_THINKING },
  thinkingText: { color: ACCENT, fontSize: 13, fontStyle: "italic" },
  recordingBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#1A0F0F",
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: RECORDING_RED,
    marginRight: 8,
  },
  recordingText: { color: RECORDING_RED, fontSize: 13 },
  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: SURFACE,
    borderTopWidth: 0.5,
    borderTopColor: BORDER,
  },
  input: {
    flex: 1,
    backgroundColor: BG,
    color: TEXT_PRIMARY,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: BORDER,
  },
  sendButton: { marginLeft: 8, backgroundColor: ACCENT, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  micButton: {
    marginLeft: 8,
    backgroundColor: ACCENT,
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  micButtonRecording: { backgroundColor: RECORDING_RED },
  sendButtonPressed: { opacity: 0.8 },
  sendButtonText: { color: "#FFFFFF", fontWeight: "600", fontSize: 15 },
});
