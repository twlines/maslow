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
import * as SecureStore from "expo-secure-store";
import * as Haptics from "expo-haptics";
import {
  connect, disconnect, sendChat, sendVoice, setCallbacks, api,
  type PresenceState,
} from "../../services/api";

// Haptic feedback — no-op on web
function haptic(style: "light" | "medium" | "success" = "light") {
  if (Platform.OS === "web") return;
  if (style === "success") {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  } else {
    const impact = style === "medium"
      ? Haptics.ImpactFeedbackStyle.Medium
      : Haptics.ImpactFeedbackStyle.Light;
    Haptics.impactAsync(impact).catch(() => {});
  }
}

// Cross-platform key-value store (SecureStore on native, localStorage on web)
async function getStoredValue(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try { return localStorage.getItem(key) } catch { return null }
  }
  return SecureStore.getItemAsync(key)
}
async function setStoredValue(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try { localStorage.setItem(key, value) } catch { /* noop */ }
    return
  }
  await SecureStore.setItemAsync(key, value)
}

const ACCENT = "#7C5CFC";
const BG = "#0F0F0F";
const SURFACE = "#1A1A1A";
const TEXT_PRIMARY = "#E5E5E5";
const TEXT_SECONDARY = "#999999";
const BORDER = "#333333";
const AI_THINKING = "#2D2044";
const RECORDING_RED = "#F87171";
const SUCCESS_GREEN = "#34D399";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  timestamp: number;
  type?: "text" | "action" | "system" | "transcription";
  actionIcon?: string;
}

// Workspace action notification — card "peels off" from chat
function ActionNotification({ icon, children }: { icon: string; children: React.ReactNode }) {
  const slideX = useRef(new Animated.Value(-40)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scaleY = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(slideX, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(scaleY, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]),
    ]).start();
  }, [slideX, opacity, scaleY]);

  return (
    <Animated.View
      style={[
        styles.actionNotification,
        { transform: [{ translateX: slideX }, { scaleY }], opacity },
      ]}
    >
      <View style={styles.actionIconContainer}>
        <FontAwesome name={icon as "home"} size={11} color="#FFFFFF" />
      </View>
      <Text style={styles.actionNotificationText}>{children}</Text>
    </Animated.View>
  );
}

// Voice transcription morphing — waveform bar morphs into text
function TranscriptionMorph({ text }: { text: string }) {
  const barWidth = useRef(new Animated.Value(1)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(barWidth, { toValue: 0, duration: 400, useNativeDriver: true }),
      Animated.timing(textOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [barWidth, textOpacity]);

  return (
    <View style={styles.transcriptionMorph}>
      <Animated.View
        style={[
          styles.transcriptionBar,
          { transform: [{ scaleX: barWidth }] },
        ]}
      />
      <Animated.View style={{ opacity: textOpacity, position: "absolute", left: 0, right: 0 }}>
        <View style={[styles.messageBubble, styles.userBubble]}>
          <Text style={[styles.messageText, styles.userMessageText]}>{text}</Text>
        </View>
      </Animated.View>
    </View>
  );
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

// Message settle animation — fade in + slide up
function SettlingMessage({ children }: { children: React.ReactNode }) {
  const translateY = useRef(new Animated.Value(8)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [translateY, opacity]);

  return (
    <Animated.View style={{ transform: [{ translateY }], opacity }}>
      {children}
    </Animated.View>
  );
}

// Animated blinking cursor for streaming text
function BlinkingCursor() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return (
    <Animated.Text style={[styles.cursor, { opacity }]}>|</Animated.Text>
  );
}

// Onboarding — first launch experience
const ONBOARDING_KEY = "maslow_onboarded";
const ONBOARDING_LINES = [
  "Hey.",
  "",
  "I'm Maslow.",
  "",
  "We've been talking on Telegram \u2014",
  "this is home now.",
  "",
  "What should we work on first?",
];

function OnboardingOverlay({ onComplete }: { onComplete: () => void }) {
  const [visibleLines, setVisibleLines] = useState(0);
  const orbPulse = useRef(new Animated.Value(1)).current;
  const orbOpacity = useRef(new Animated.Value(0.4)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fade in the overlay
    Animated.timing(fadeIn, { toValue: 1, duration: 600, useNativeDriver: true }).start();

    // Orb breathing
    const orbAnim = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(orbPulse, { toValue: 1.15, duration: 2000, useNativeDriver: true }),
          Animated.timing(orbOpacity, { toValue: 0.7, duration: 2000, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(orbPulse, { toValue: 1, duration: 2000, useNativeDriver: true }),
          Animated.timing(orbOpacity, { toValue: 0.4, duration: 2000, useNativeDriver: true }),
        ]),
      ])
    );
    orbAnim.start();

    // Type out lines with delays
    let timeout: ReturnType<typeof setTimeout>;
    const typeLines = (index: number) => {
      if (index > ONBOARDING_LINES.length) return;
      const delay = ONBOARDING_LINES[index - 1] === "" ? 300 : 800;
      timeout = setTimeout(() => {
        setVisibleLines(index);
        typeLines(index + 1);
      }, delay);
    };
    // Start after a pause
    timeout = setTimeout(() => typeLines(1), 1200);

    return () => {
      clearTimeout(timeout);
      orbAnim.stop();
    };
  }, [fadeIn, orbPulse, orbOpacity]);

  const allVisible = visibleLines >= ONBOARDING_LINES.length;

  const handleStart = async () => {
    await setStoredValue(ONBOARDING_KEY, "true");
    onComplete();
  };

  return (
    <Animated.View style={[styles.onboardingOverlay, { opacity: fadeIn }]}>
      <View style={styles.onboardingContent}>
        <Animated.View
          style={[
            styles.onboardingOrb,
            { transform: [{ scale: orbPulse }], opacity: orbOpacity },
          ]}
        />
        <View style={styles.onboardingOrbInner} />

        <View style={styles.onboardingText}>
          {ONBOARDING_LINES.slice(0, visibleLines).map((line, i) =>
            line === "" ? (
              <View key={i} style={{ height: 12 }} />
            ) : (
              <Text key={i} style={styles.onboardingLine}>{line}</Text>
            )
          )}
        </View>

        {allVisible && (
          <Pressable
            style={({ pressed }) => [styles.onboardingButton, pressed && { opacity: 0.8 }]}
            onPress={handleStart}
          >
            <Text style={styles.onboardingButtonText}>Let's go</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

interface ProjectInfo {
  id: string;
  name: string;
}

// Briefing card — appears when the user opens the app
function BriefingCard({
  briefing,
  onDismiss,
}: {
  briefing: { briefing: string; projectCount: number };
  onDismiss: () => void;
}) {
  const slideY = useRef(new Animated.Value(-20)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 0, duration: 400, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [slideY, opacity]);

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: -20, duration: 200, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => onDismiss());
  };

  // Parse brief markdown sections into lines
  const lines = briefing.briefing.split("\n").filter((l) => l.trim());
  const preview = lines.slice(0, 6);

  return (
    <Animated.View style={[styles.briefingCard, { transform: [{ translateY: slideY }], opacity }]}>
      <View style={styles.briefingHeader}>
        <View style={styles.briefingTitleRow}>
          <FontAwesome name="sun-o" size={14} color={ACCENT} />
          <Text style={styles.briefingTitle}>
            Morning Briefing
          </Text>
        </View>
        <Pressable onPress={handleDismiss} hitSlop={8}>
          <FontAwesome name="times" size={14} color={TEXT_SECONDARY} />
        </Pressable>
      </View>
      <View style={styles.briefingBody}>
        {preview.map((line, i) => {
          const isHeader = line.startsWith("##");
          const isBold = line.startsWith("**");
          const clean = line.replace(/^#+\s*/, "").replace(/\*\*/g, "");
          return (
            <Text
              key={i}
              style={[
                styles.briefingLine,
                isHeader && styles.briefingLineHeader,
                isBold && styles.briefingLineBold,
              ]}
              numberOfLines={1}
            >
              {clean}
            </Text>
          );
        })}
        {lines.length > 6 && (
          <Text style={styles.briefingMore}>
            +{lines.length - 6} more across {briefing.projectCount} projects
          </Text>
        )}
      </View>
    </Animated.View>
  );
}

export default function TalkScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [presence, setPresence] = useState<PresenceState>("idle");
  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeProject, setActiveProject] = useState<string | undefined>(undefined);
  const [isStreaming, setIsStreaming] = useState(false);
  const [briefing, setBriefing] = useState<{ briefing: string; projectCount: number } | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const streamingRef = useRef<Map<string, string>>(new Map());
  const mediaRecorderRef = useRef<any>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    setCallbacks({
      onStream: (content, messageId) => {
        const current = streamingRef.current.get(messageId) || "";
        if (!current) haptic("light"); // First token — gentle pulse
        const updated = current + content;
        streamingRef.current.set(messageId, updated);
        setIsStreaming(true);

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
        setIsStreaming(streamingRef.current.size > 0);
        haptic("medium"); // Response complete
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, content: message.content, streaming: false } : m
          )
        );
      },
      onTranscription: (messageId, text) => {
        setMessages((prev) => [
          ...prev,
          { id: messageId, role: "user", content: text, timestamp: Date.now(), type: "transcription" as const },
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
          { id: `sys-${Date.now()}`, role: "assistant", content: `[${message}]`, timestamp: Date.now(), type: "system" as const },
        ]);
      },
      onHandoffComplete: (_conversationId, message) => {
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, role: "assistant", content: `[${message}]`, timestamp: Date.now(), type: "system" as const },
        ]);
      },
      onWorkspaceAction: (action, data) => {
        const actionMeta: Record<string, { label: string; icon: string }> = {
          card_created: { label: `Created card: "${data.title}" → ${data.column}`, icon: "plus-square" },
          card_moved: { label: `Moved: "${data.title}" → ${data.column}`, icon: "arrow-right" },
          decision_logged: { label: `Decision: "${data.title}"`, icon: "gavel" },
          assumption_tracked: { label: `Assumption: "${data.assumption}"`, icon: "question-circle" },
          state_updated: { label: "Updated project state", icon: "refresh" },
        };
        const meta = actionMeta[action] || { label: action, icon: "bolt" };
        haptic("success"); // Workspace action — satisfying confirmation
        setMessages((prev) => [
          ...prev,
          {
            id: `action-${Date.now()}`,
            role: "assistant",
            content: meta.label,
            timestamp: Date.now(),
            type: "action" as const,
            actionIcon: meta.icon,
          },
        ]);
      },
      onPresence: (state) => setPresence(state),
      onOpen: () => setConnected(true),
      onClose: () => setConnected(false),
    });

    connect();

    // Fetch projects for thread selector
    api.getProjects().then((p) => setProjects(p.map((x: any) => ({ id: x.id, name: x.name })))).catch(() => {});

    // Check if first launch
    getStoredValue(ONBOARDING_KEY).then((val) => {
      if (!val) setShowOnboarding(true);
      setOnboardingChecked(true);
    }).catch(() => setOnboardingChecked(true));

    // Fetch briefing on launch
    api.getBriefing().then((b) => {
      if (b.projectCount > 0) setBriefing(b);
    }).catch(() => {});

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

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    const isUser = item.role === "user";

    // Workspace action — animated notification with icon
    if (item.type === "action") {
      return (
        <ActionNotification icon={item.actionIcon || "bolt"}>
          {item.content}
        </ActionNotification>
      );
    }

    // System message (handoff, etc.)
    const isSystem = item.content.startsWith("[") && item.content.endsWith("]");
    if (isSystem) {
      return (
        <SettlingMessage>
          <View style={styles.systemMessage}>
            <Text style={styles.systemMessageText}>{item.content.slice(1, -1)}</Text>
          </View>
        </SettlingMessage>
      );
    }

    // Voice transcription — morphing animation
    if (item.type === "transcription") {
      return <TranscriptionMorph text={item.content} />;
    }

    return (
      <SettlingMessage>
        <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble]}>
          <Text style={[styles.messageText, isUser && styles.userMessageText]}>
            {item.content}
            {item.streaming && <BlinkingCursor />}
          </Text>
        </View>
      </SettlingMessage>
    );
  }, []);

  const showPresence = messages.length === 0;
  const showMic = !input.trim();

  // Show onboarding overlay on first launch
  if (showOnboarding && onboardingChecked) {
    return (
      <View style={styles.container}>
        <OnboardingOverlay onComplete={() => setShowOnboarding(false)} />
      </View>
    );
  }

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

      {briefing && showPresence && (
        <BriefingCard briefing={briefing} onDismiss={() => setBriefing(null)} />
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

      {!showPresence && presence === "thinking" && !isStreaming && (
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
  systemMessage: {
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: AI_THINKING,
  },
  systemMessageText: {
    color: ACCENT,
    fontSize: 12,
    fontStyle: "italic",
  },

  // Action notifications
  actionNotification: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    borderRadius: 10,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: SUCCESS_GREEN + "44",
  },
  actionIconContainer: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: SUCCESS_GREEN,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  actionNotificationText: {
    color: TEXT_PRIMARY,
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },

  // Transcription morph
  transcriptionMorph: {
    alignSelf: "flex-end",
    maxWidth: "80%",
    marginBottom: 8,
    minHeight: 40,
    justifyContent: "center",
  },
  transcriptionBar: {
    height: 3,
    backgroundColor: ACCENT,
    borderRadius: 2,
    marginHorizontal: 14,
  },

  // Briefing card
  briefingCard: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: ACCENT + "33",
    overflow: "hidden",
  },
  briefingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
  },
  briefingTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  briefingTitle: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  briefingBody: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  briefingLine: {
    color: TEXT_SECONDARY,
    fontSize: 13,
    lineHeight: 20,
  },
  briefingLineHeader: {
    color: TEXT_PRIMARY,
    fontWeight: "600",
    fontSize: 14,
    marginTop: 6,
    marginBottom: 2,
  },
  briefingLineBold: {
    color: TEXT_PRIMARY,
    fontWeight: "500",
  },
  briefingMore: {
    color: TEXT_SECONDARY,
    fontSize: 11,
    fontStyle: "italic",
    marginTop: 8,
    opacity: 0.7,
  },

  // Onboarding
  onboardingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  onboardingContent: {
    alignItems: "center",
    paddingHorizontal: 40,
  },
  onboardingOrb: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: ACCENT,
    top: -100,
  },
  onboardingOrbInner: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: ACCENT,
    marginBottom: 48,
  },
  onboardingText: {
    alignItems: "center",
    minHeight: 180,
  },
  onboardingLine: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: "300",
    textAlign: "center",
    lineHeight: 30,
  },
  onboardingButton: {
    backgroundColor: ACCENT,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 24,
    marginTop: 32,
  },
  onboardingButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});
