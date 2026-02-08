import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  FlatList,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Animated,
  Dimensions,
} from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { api, connect, addCallbacks } from "../../services/api";

// ---- Theme ----
const BG = "#0F0F0F";
const SURFACE = "#1A1A1A";
const SURFACE2 = "#252525";
const TEXT_PRIMARY = "#E5E5E5";
const TEXT_SECONDARY = "#999999";
const ACCENT = "#7C5CFC";
const BORDER = "#333333";

// ---- Types ----
interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  color?: string;
}

interface Card {
  id: string;
  projectId: string;
  title: string;
  description: string;
  column: string;
  labels: string[];
  position: number;
  createdAt: string;
  updatedAt: string;
}

interface Board {
  backlog: Card[];
  in_progress: Card[];
  done: Card[];
}

interface Doc {
  id: string;
  projectId: string;
  type: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface Decision {
  id: string;
  projectId: string;
  title: string;
  reasoning: string;
  alternatives: string[];
  createdAt: string;
  updatedAt: string;
}

// ---- Helpers ----
const STATUS_COLORS: Record<string, string> = {
  active: "#34D399",
  paused: "#FBBF24",
  archived: "#666666",
};

const DOC_TYPES = ["brief", "instructions", "reference", "state", "assumptions", "decisions"];

const DOC_TYPE_LABELS: Record<string, string> = {
  brief: "Brief",
  instructions: "Instructions",
  reference: "Reference",
  state: "State",
  assumptions: "Assumptions",
  decisions: "Decisions",
};

const AGENT_BLUE = "#60A5FA";
const ERROR_RED = "#F87171";
const SUCCESS_GREEN = "#34D399";
const LABEL_COLORS = ["#7C5CFC", "#34D399", "#F87171", "#FBBF24", "#60A5FA", "#A78BFA"];
const SIDEBAR_WIDTH = Math.min(320, Dimensions.get("window").width * 0.8);

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function truncate(str: string, len: number): string {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "..." : str;
}

// ---- Components ----

/** StatusDot - colored dot for project status */
function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || STATUS_COLORS.active;
  return <View style={[styles.statusDot, { backgroundColor: color }]} />;
}

/** CreateProjectModal - modal form for creating a project */
function CreateProjectModal({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    onCreate(name.trim(), description.trim());
    setName("");
    setDescription("");
    setSubmitting(false);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalCenter}
        >
          <Pressable style={styles.modalContent} onPress={() => {}}>
            <Text style={styles.modalTitle}>New Project</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Project name"
              placeholderTextColor={TEXT_SECONDARY}
              value={name}
              onChangeText={setName}
              autoFocus
              returnKeyType="next"
            />
            <TextInput
              style={[styles.modalInput, styles.modalInputMultiline]}
              placeholder="Description (optional)"
              placeholderTextColor={TEXT_SECONDARY}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={onClose}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalCreateBtn, !name.trim() && styles.modalCreateBtnDisabled]}
                onPress={handleCreate}
                disabled={!name.trim() || submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalCreateText}>Create</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

/** CreateDocModal - modal form for creating a document */
function CreateDocModal({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (type: string, title: string, content: string) => void;
}) {
  const [docType, setDocType] = useState("brief");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    onCreate(docType, title.trim(), content.trim());
    setDocType("brief");
    setTitle("");
    setContent("");
    setSubmitting(false);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalCenter}
        >
          <Pressable style={styles.modalContent} onPress={() => {}}>
            <Text style={styles.modalTitle}>New Document</Text>

            <Text style={styles.modalLabel}>Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.docTypePicker}>
              {DOC_TYPES.map((t) => (
                <Pressable
                  key={t}
                  style={[styles.docTypeChip, docType === t && styles.docTypeChipActive]}
                  onPress={() => setDocType(t)}
                >
                  <Text
                    style={[styles.docTypeChipText, docType === t && styles.docTypeChipTextActive]}
                  >
                    {DOC_TYPE_LABELS[t]}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <TextInput
              style={styles.modalInput}
              placeholder="Title"
              placeholderTextColor={TEXT_SECONDARY}
              value={title}
              onChangeText={setTitle}
              returnKeyType="next"
            />
            <TextInput
              style={[styles.modalInput, styles.modalInputLarge]}
              placeholder="Content"
              placeholderTextColor={TEXT_SECONDARY}
              value={content}
              onChangeText={setContent}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={onClose}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalCreateBtn, !title.trim() && styles.modalCreateBtnDisabled]}
                onPress={handleCreate}
                disabled={!title.trim() || submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalCreateText}>Create</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

/** CardDetailModal - view/edit a card, move columns, delete */
function CardDetailModal({
  card,
  projectId,
  onClose,
  onUpdate,
  onDelete,
}: {
  card: Card | null;
  projectId: string;
  onClose: () => void;
  onUpdate: () => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [column, setColumn] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (card) {
      setTitle(card.title);
      setDescription(card.description || "");
      setColumn(card.column);
      setDirty(false);
    }
  }, [card]);

  const handleSave = async () => {
    if (!card || !title.trim()) return;
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      if (title.trim() !== card.title) updates.title = title.trim();
      if (description.trim() !== (card.description || "")) updates.description = description.trim();
      if (column !== card.column) updates.column = column;
      if (Object.keys(updates).length > 0) {
        await api.updateCard(projectId, card.id, updates);
      }
      onUpdate();
      onClose();
    } catch (err) {
      console.error("Failed to update card:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!card) return;
    if (Platform.OS === "web") {
      if (!confirm("Delete this card?")) return;
      performDelete();
    } else {
      Alert.alert("Delete Card", "Are you sure you want to delete this card?", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: performDelete },
      ]);
    }
  };

  const performDelete = async () => {
    if (!card) return;
    setDeleting(true);
    try {
      await api.deleteCard(projectId, card.id);
      onDelete();
      onClose();
    } catch (err) {
      console.error("Failed to delete card:", err);
    } finally {
      setDeleting(false);
    }
  };

  const columns: { key: string; label: string }[] = [
    { key: "backlog", label: "Backlog" },
    { key: "in_progress", label: "In Progress" },
    { key: "done", label: "Done" },
  ];

  if (!card) return null;

  return (
    <Modal visible={!!card} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalCenter}
        >
          <Pressable style={styles.modalContent} onPress={() => {}}>
            <View style={styles.detailHeader}>
              <Text style={styles.modalTitle}>Card</Text>
              <Pressable onPress={handleDelete} disabled={deleting}>
                <FontAwesome
                  name="trash-o"
                  size={18}
                  color={deleting ? TEXT_SECONDARY : "#F87171"}
                />
              </Pressable>
            </View>

            <TextInput
              style={styles.modalInput}
              value={title}
              onChangeText={(t) => { setTitle(t); setDirty(true); }}
              placeholder="Title"
              placeholderTextColor={TEXT_SECONDARY}
            />
            <TextInput
              style={[styles.modalInput, styles.modalInputMultiline]}
              value={description}
              onChangeText={(t) => { setDescription(t); setDirty(true); }}
              placeholder="Description (optional)"
              placeholderTextColor={TEXT_SECONDARY}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <Text style={styles.modalLabel}>Column</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.docTypePicker}>
              {columns.map((col) => (
                <Pressable
                  key={col.key}
                  style={[styles.docTypeChip, column === col.key && styles.docTypeChipActive]}
                  onPress={() => { setColumn(col.key); setDirty(true); }}
                >
                  <Text
                    style={[styles.docTypeChipText, column === col.key && styles.docTypeChipTextActive]}
                  >
                    {col.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {card.labels && card.labels.length > 0 && (
              <View style={styles.detailLabels}>
                <Text style={styles.modalLabel}>Labels</Text>
                <View style={styles.cardLabels}>
                  {card.labels.map((label, i) => (
                    <View
                      key={`${label}-${i}`}
                      style={[
                        styles.labelPill,
                        { backgroundColor: LABEL_COLORS[i % LABEL_COLORS.length] + "33" },
                      ]}
                    >
                      <Text
                        style={[styles.labelText, { color: LABEL_COLORS[i % LABEL_COLORS.length] }]}
                      >
                        {label}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <Text style={styles.detailTimestamp}>
              Created {relativeTime(card.createdAt)}
              {card.updatedAt !== card.createdAt ? ` · Updated ${relativeTime(card.updatedAt)}` : ""}
            </Text>

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={onClose}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalCreateBtn, (!dirty || !title.trim()) && styles.modalCreateBtnDisabled]}
                onPress={handleSave}
                disabled={!dirty || !title.trim() || saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalCreateText}>Save</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

/** DocDetailModal - view/edit a document's content */
function DocDetailModal({
  doc,
  projectId,
  onClose,
  onUpdate,
}: {
  doc: Doc | null;
  projectId: string;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (doc) {
      setTitle(doc.title);
      setContent(doc.content || "");
      setDirty(false);
    }
  }, [doc]);

  const handleSave = async () => {
    if (!doc || !title.trim()) return;
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      if (title.trim() !== doc.title) updates.title = title.trim();
      if (content !== (doc.content || "")) updates.content = content;
      if (Object.keys(updates).length > 0) {
        await api.updateProjectDoc(projectId, doc.id, updates);
      }
      onUpdate();
      onClose();
    } catch (err) {
      console.error("Failed to update doc:", err);
    } finally {
      setSaving(false);
    }
  };

  if (!doc) return null;

  return (
    <Modal visible={!!doc} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalCenter}
        >
          <Pressable style={[styles.modalContent, styles.modalContentTall]} onPress={() => {}}>
            <View style={styles.detailHeader}>
              <View>
                <Text style={styles.docDetailType}>
                  {DOC_TYPE_LABELS[doc.type] || doc.type}
                </Text>
                <Text style={styles.detailTimestamp}>
                  Updated {relativeTime(doc.updatedAt)}
                </Text>
              </View>
            </View>

            <TextInput
              style={styles.modalInput}
              value={title}
              onChangeText={(t) => { setTitle(t); setDirty(true); }}
              placeholder="Title"
              placeholderTextColor={TEXT_SECONDARY}
            />
            <TextInput
              style={[styles.modalInput, styles.modalInputLarge]}
              value={content}
              onChangeText={(t) => { setContent(t); setDirty(true); }}
              placeholder="Content"
              placeholderTextColor={TEXT_SECONDARY}
              multiline
              textAlignVertical="top"
            />

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={onClose}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalCreateBtn, (!dirty || !title.trim()) && styles.modalCreateBtnDisabled]}
                onPress={handleSave}
                disabled={!dirty || !title.trim() || saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalCreateText}>Save</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

/** DecisionDetailModal - view full decision details */
function DecisionDetailModal({
  decision,
  onClose,
}: {
  decision: Decision | null;
  onClose: () => void;
}) {
  if (!decision) return null;

  const alternatives = Array.isArray(decision.alternatives)
    ? decision.alternatives
    : typeof decision.alternatives === "string" && decision.alternatives
      ? [decision.alternatives]
      : [];

  return (
    <Modal visible={!!decision} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={styles.modalCenter}>
          <Pressable style={[styles.modalContent, styles.modalContentTall]} onPress={() => {}}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>{decision.title}</Text>
              <Text style={styles.detailTimestamp}>
                Decided {relativeTime(decision.createdAt)}
              </Text>

              {decision.reasoning ? (
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>Reasoning</Text>
                  <Text style={styles.detailSectionContent}>{decision.reasoning}</Text>
                </View>
              ) : null}

              {alternatives.length > 0 ? (
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>Alternatives Considered</Text>
                  {alternatives.map((alt, i) => (
                    <View key={i} style={styles.alternativeItem}>
                      <Text style={styles.alternativeBullet}>-</Text>
                      <Text style={styles.alternativeText}>{alt}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={onClose}>
                <Text style={styles.modalCancelText}>Close</Text>
              </Pressable>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

/** DocsSidebar - slide-out panel for project living documents */
function DocsSidebar({
  visible,
  docs,
  onClose,
  onDocPress,
  onCreatePress,
}: {
  visible: boolean;
  docs: Doc[];
  onClose: () => void;
  onDocPress: (doc: Doc) => void;
  onCreatePress: () => void;
}) {
  const slideAnim = useRef(new Animated.Value(SIDEBAR_WIDTH)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: visible ? 0 : SIDEBAR_WIDTH,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [visible, slideAnim]);

  const grouped: Record<string, Doc[]> = {};
  for (const doc of docs) {
    const key = doc.type || "reference";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(doc);
  }

  return (
    <>
      {visible && (
        <Pressable style={styles.sidebarOverlay} onPress={onClose} />
      )}
      <Animated.View
        style={[
          styles.sidebar,
          { transform: [{ translateX: slideAnim }] },
        ]}
      >
        <View style={styles.sidebarHeader}>
          <Text style={styles.sidebarTitle}>Documents</Text>
          <View style={styles.sidebarHeaderActions}>
            <Pressable
              style={({ pressed }) => [styles.sidebarAddBtn, pressed && { opacity: 0.7 }]}
              onPress={onCreatePress}
            >
              <FontAwesome name="plus" size={12} color="#FFFFFF" />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.sidebarCloseBtn, pressed && { opacity: 0.7 }]}
              onPress={onClose}
            >
              <FontAwesome name="times" size={16} color={TEXT_SECONDARY} />
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={styles.sidebarContent}
          contentContainerStyle={styles.sidebarContentInner}
          showsVerticalScrollIndicator={false}
        >
          {docs.length === 0 ? (
            <View style={styles.sidebarEmpty}>
              <FontAwesome name="file-text-o" size={24} color={TEXT_SECONDARY} style={{ opacity: 0.5 }} />
              <Text style={styles.sidebarEmptyText}>No documents yet</Text>
              <Text style={styles.sidebarEmptyHint}>
                Maslow creates these as you work, or add your own.
              </Text>
            </View>
          ) : (
            DOC_TYPES.map((type) => {
              const typeDocs = grouped[type];
              if (!typeDocs || typeDocs.length === 0) return null;
              return (
                <View key={type} style={styles.sidebarDocGroup}>
                  <Text style={styles.sidebarDocGroupTitle}>{DOC_TYPE_LABELS[type]}</Text>
                  {typeDocs.map((doc) => (
                    <Pressable
                      key={doc.id}
                      style={({ pressed }) => [
                        styles.sidebarDocItem,
                        pressed && styles.sidebarDocItemPressed,
                      ]}
                      onPress={() => onDocPress(doc)}
                    >
                      <Text style={styles.sidebarDocTitle} numberOfLines={1}>
                        {doc.title}
                      </Text>
                      <Text style={styles.sidebarDocPreview} numberOfLines={1}>
                        {truncate(doc.content, 50)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              );
            })
          )}
        </ScrollView>
      </Animated.View>
    </>
  );
}

/** ProjectTile - a visual workspace object with activity stats */
function ProjectTile({
  project,
  onPress,
}: {
  project: Project;
  onPress: () => void;
}) {
  const [stats, setStats] = useState<{ backlog: number; inProgress: number; done: number } | null>(null);

  useEffect(() => {
    api.getBoard(project.id)
      .then((b: Board) => setStats({
        backlog: b.backlog.length,
        inProgress: b.in_progress.length,
        done: b.done.length,
      }))
      .catch(() => {});
  }, [project.id]);

  const totalCards = stats ? stats.backlog + stats.inProgress + stats.done : 0;
  const progressPct = stats && totalCards > 0
    ? Math.round((stats.done / totalCards) * 100)
    : 0;

  return (
    <Pressable
      style={({ pressed }) => [styles.projectTile, pressed && styles.projectTilePressed]}
      onPress={onPress}
    >
      {/* Color accent stripe */}
      <View style={[styles.tileAccent, { backgroundColor: project.color || ACCENT }]} />

      <View style={styles.tileBody}>
        <View style={styles.tileHeader}>
          <Text style={styles.tileName} numberOfLines={1}>{project.name}</Text>
          <StatusDot status={project.status} />
        </View>

        {project.description ? (
          <Text style={styles.tileDescription} numberOfLines={2}>
            {project.description}
          </Text>
        ) : null}

        {/* Progress bar */}
        {stats && totalCards > 0 && (
          <View style={styles.tileProgress}>
            <View style={styles.tileProgressBar}>
              <View
                style={[
                  styles.tileProgressFill,
                  { width: `${progressPct}%`, backgroundColor: project.color || ACCENT },
                ]}
              />
            </View>
            <Text style={styles.tileProgressLabel}>{progressPct}%</Text>
          </View>
        )}

        {/* Card stats row */}
        {stats && (
          <View style={styles.tileStats}>
            {stats.inProgress > 0 && (
              <View style={styles.tileStat}>
                <View style={[styles.tileStatDot, { backgroundColor: "#FBBF24" }]} />
                <Text style={styles.tileStatText}>{stats.inProgress} active</Text>
              </View>
            )}
            {stats.backlog > 0 && (
              <View style={styles.tileStat}>
                <View style={[styles.tileStatDot, { backgroundColor: TEXT_SECONDARY }]} />
                <Text style={styles.tileStatText}>{stats.backlog} backlog</Text>
              </View>
            )}
            {stats.done > 0 && (
              <View style={styles.tileStat}>
                <View style={[styles.tileStatDot, { backgroundColor: "#34D399" }]} />
                <Text style={styles.tileStatText}>{stats.done} done</Text>
              </View>
            )}
          </View>
        )}

        <Text style={styles.tileUpdated}>{relativeTime(project.updatedAt)}</Text>
      </View>
    </Pressable>
  );
}

interface AgentActivity {
  cardId: string;
  agent: string;
  status: "running" | "completed" | "failed";
  lastLog?: string;
  error?: string;
  updatedAt: number;
}

/** AgentActivityBar - shows running/recent agent activity */
function AgentActivityBar({ activities }: { activities: AgentActivity[] }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const running = activities.filter((a) => a.status === "running");

  useEffect(() => {
    if (running.length === 0) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [running.length, pulseAnim]);

  if (activities.length === 0) return null;

  return (
    <View style={styles.agentBar}>
      {activities.map((a) => {
        const isRunning = a.status === "running";
        const isFailed = a.status === "failed";
        const dotColor = isRunning ? AGENT_BLUE : isFailed ? ERROR_RED : SUCCESS_GREEN;
        const label = isRunning
          ? `${a.agent} working on ${a.cardId.slice(0, 8)}...`
          : isFailed
            ? `${a.agent} failed: ${a.error || "unknown"}`
            : `${a.agent} completed ${a.cardId.slice(0, 8)}...`;

        return (
          <View key={a.cardId} style={styles.agentBarItem}>
            <Animated.View
              style={[
                styles.agentBarDot,
                { backgroundColor: dotColor },
                isRunning && { opacity: pulseAnim },
              ]}
            />
            <Text style={styles.agentBarText} numberOfLines={1}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** ProjectListView - workspace map of all projects */
function ProjectListView({
  projects,
  loading,
  onSelect,
  onCreatePress,
}: {
  projects: Project[];
  loading: boolean;
  onSelect: (p: Project) => void;
  onCreatePress: () => void;
}) {
  const screenWidth = Dimensions.get("window").width;
  const useGrid = screenWidth > 600;

  return (
    <View style={styles.container}>
      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Projects</Text>
        <Pressable
          style={({ pressed }) => [styles.addProjectBtn, pressed && { opacity: 0.7 }]}
          onPress={onCreatePress}
        >
          <FontAwesome name="plus" size={16} color="#FFFFFF" />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={ACCENT} />
        </View>
      ) : projects.length === 0 ? (
        <View style={styles.centered}>
          <FontAwesome name="th-large" size={48} color={ACCENT} style={{ opacity: 0.5 }} />
          <Text style={styles.emptyTitle}>No projects yet</Text>
          <Text style={styles.emptySubtitle}>
            Tap the + button to create your first project.
          </Text>
        </View>
      ) : (
        <FlatList
          data={projects}
          renderItem={({ item }) => (
            <View style={useGrid ? styles.gridItem : undefined}>
              <ProjectTile project={item} onPress={() => onSelect(item)} />
            </View>
          )}
          keyExtractor={(item) => item.id}
          numColumns={useGrid ? 2 : 1}
          key={useGrid ? "grid" : "list"}
          contentContainerStyle={styles.projectList}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

/** BoardColumn - a single kanban column */
function BoardColumn({
  title,
  cards,
  showAddCard,
  onAddCard,
  onCardPress,
}: {
  title: string;
  cards: Card[];
  showAddCard?: boolean;
  onAddCard?: (title: string) => void;
  onCardPress?: (card: Card) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newCardTitle, setNewCardTitle] = useState("");

  const handleAdd = () => {
    if (!newCardTitle.trim()) return;
    onAddCard?.(newCardTitle.trim());
    setNewCardTitle("");
    setAdding(false);
  };

  return (
    <View style={styles.boardColumn}>
      <View style={styles.columnHeader}>
        <Text style={styles.columnTitle}>{title}</Text>
        <View style={styles.columnCount}>
          <Text style={styles.columnCountText}>{cards.length}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.columnCards}
        contentContainerStyle={styles.columnCardsContent}
        showsVerticalScrollIndicator={false}
      >
        {cards.map((card) => (
          <Pressable
            key={card.id}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => onCardPress?.(card)}
          >
            <Text style={styles.cardTitle} numberOfLines={2}>
              {card.title}
            </Text>
            {card.description ? (
              <Text style={styles.cardDescription} numberOfLines={2}>
                {truncate(card.description, 60)}
              </Text>
            ) : null}
            {card.labels && card.labels.length > 0 ? (
              <View style={styles.cardLabels}>
                {card.labels.map((label, i) => (
                  <View
                    key={`${label}-${i}`}
                    style={[
                      styles.labelPill,
                      { backgroundColor: LABEL_COLORS[i % LABEL_COLORS.length] + "33" },
                    ]}
                  >
                    <Text
                      style={[
                        styles.labelText,
                        { color: LABEL_COLORS[i % LABEL_COLORS.length] },
                      ]}
                    >
                      {label}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </Pressable>
        ))}

        {showAddCard && !adding && (
          <Pressable
            style={({ pressed }) => [styles.addCardBtn, pressed && { opacity: 0.7 }]}
            onPress={() => setAdding(true)}
          >
            <FontAwesome name="plus" size={12} color={TEXT_SECONDARY} />
            <Text style={styles.addCardText}>Add card</Text>
          </Pressable>
        )}

        {adding && (
          <View style={styles.addCardInput}>
            <TextInput
              style={styles.addCardTextInput}
              placeholder="Card title..."
              placeholderTextColor={TEXT_SECONDARY}
              value={newCardTitle}
              onChangeText={setNewCardTitle}
              onSubmitEditing={handleAdd}
              autoFocus
              returnKeyType="done"
            />
            <View style={styles.addCardActions}>
              <Pressable style={styles.addCardConfirm} onPress={handleAdd}>
                <Text style={styles.addCardConfirmText}>Add</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setAdding(false);
                  setNewCardTitle("");
                }}
              >
                <FontAwesome name="times" size={16} color={TEXT_SECONDARY} />
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/** BoardView - horizontal scrollable kanban board */
function BoardView({
  board,
  loading,
  onAddCard,
  onCardPress,
}: {
  board: Board | null;
  loading: boolean;
  onAddCard: (title: string) => void;
  onCardPress: (card: Card) => void;
}) {
  if (loading || !board) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={ACCENT} />
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.boardContainer}
    >
      <BoardColumn title="Backlog" cards={board.backlog} showAddCard onAddCard={onAddCard} onCardPress={onCardPress} />
      <BoardColumn title="In Progress" cards={board.in_progress} onCardPress={onCardPress} />
      <BoardColumn title="Done" cards={board.done} onCardPress={onCardPress} />
    </ScrollView>
  );
}

/** DocsView - project documents grouped by type */
function DocsView({
  docs,
  loading,
  onCreatePress,
  onDocPress,
}: {
  docs: Doc[];
  loading: boolean;
  onCreatePress: () => void;
  onDocPress: (doc: Doc) => void;
}) {
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={ACCENT} />
      </View>
    );
  }

  const grouped: Record<string, Doc[]> = {};
  for (const doc of docs) {
    const key = doc.type || "reference";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(doc);
  }

  const hasAnyDocs = docs.length > 0;

  return (
    <ScrollView style={styles.docsContainer} contentContainerStyle={styles.docsContent}>
      <View style={styles.docsHeader}>
        <Text style={styles.docsTitle}>Documents</Text>
        <Pressable
          style={({ pressed }) => [styles.addDocBtn, pressed && { opacity: 0.7 }]}
          onPress={onCreatePress}
        >
          <FontAwesome name="plus" size={14} color="#FFFFFF" />
        </Pressable>
      </View>

      {!hasAnyDocs ? (
        <View style={styles.emptySection}>
          <FontAwesome name="file-text-o" size={32} color={TEXT_SECONDARY} style={{ opacity: 0.5 }} />
          <Text style={styles.emptySectionText}>No documents yet</Text>
        </View>
      ) : (
        DOC_TYPES.map((type) => {
          const typeDocs = grouped[type];
          if (!typeDocs || typeDocs.length === 0) return null;
          return (
            <View key={type} style={styles.docGroup}>
              <Text style={styles.docGroupTitle}>{DOC_TYPE_LABELS[type]}</Text>
              {typeDocs.map((doc) => (
                <Pressable
                  key={doc.id}
                  style={({ pressed }) => [styles.docCard, pressed && styles.docCardPressed]}
                  onPress={() => onDocPress(doc)}
                >
                  <Text style={styles.docCardTitle}>{doc.title}</Text>
                  <Text style={styles.docCardPreview} numberOfLines={2}>
                    {truncate(doc.content, 80)}
                  </Text>
                </Pressable>
              ))}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

/** DecisionsView - list of project decisions */
function DecisionsView({
  decisions,
  loading,
  onDecisionPress,
}: {
  decisions: Decision[];
  loading: boolean;
  onDecisionPress: (decision: Decision) => void;
}) {
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={ACCENT} />
      </View>
    );
  }

  if (decisions.length === 0) {
    return (
      <View style={styles.centered}>
        <FontAwesome name="gavel" size={32} color={TEXT_SECONDARY} style={{ opacity: 0.5 }} />
        <Text style={styles.emptySectionText}>No decisions recorded</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={decisions}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.decisionsList}
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.decisionCard, pressed && styles.decisionCardPressed]}
          onPress={() => onDecisionPress(item)}
        >
          <Text style={styles.decisionTitle}>{item.title}</Text>
          {item.reasoning ? (
            <Text style={styles.decisionReasoning} numberOfLines={3}>
              {truncate(item.reasoning, 120)}
            </Text>
          ) : null}
          <View style={styles.decisionMeta}>
            <Text style={styles.decisionTimestamp}>{relativeTime(item.createdAt)}</Text>
            {item.alternatives && item.alternatives.length > 0 ? (
              <View style={styles.alternativesBadge}>
                <Text style={styles.alternativesBadgeText}>
                  {item.alternatives.length} alt{item.alternatives.length !== 1 ? "s" : ""}
                </Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      )}
    />
  );
}

/** WorkspaceTabBar - sub-tab navigation within a project */
function WorkspaceTabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: "board" | "docs" | "decisions";
  onTabChange: (tab: "board" | "docs" | "decisions") => void;
}) {
  const tabs: { key: "board" | "docs" | "decisions"; label: string }[] = [
    { key: "board", label: "Board" },
    { key: "docs", label: "Docs" },
    { key: "decisions", label: "Decisions" },
  ];

  return (
    <View style={styles.workspaceTabBar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {tabs.map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.workspaceTab, activeTab === tab.key && styles.workspaceTabActive]}
            onPress={() => onTabChange(tab.key)}
          >
            <Text
              style={[
                styles.workspaceTabText,
                activeTab === tab.key && styles.workspaceTabTextActive,
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** ProjectWorkspaceView - the full project workspace with sub-tabs */
function ProjectWorkspaceView({
  project,
  onBack,
}: {
  project: Project;
  onBack: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"board" | "docs" | "decisions">("board");
  const [board, setBoard] = useState<Board | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingDecisions, setLoadingDecisions] = useState(false);
  const [showDocModal, setShowDocModal] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);
  const [agentActivities, setAgentActivities] = useState<AgentActivity[]>([]);
  const fetchBoardRef = useRef<() => void>(() => {});

  // Subscribe to agent WebSocket events via addCallbacks (non-destructive)
  useEffect(() => {
    connect();
    const unsubscribe = addCallbacks({
      onAgentSpawned: (cardId, agent) => {
        setAgentActivities((prev) => {
          const filtered = prev.filter((a) => a.cardId !== cardId);
          return [...filtered, { cardId, agent, status: "running", updatedAt: Date.now() }];
        });
      },
      onAgentLog: (cardId, line) => {
        setAgentActivities((prev) =>
          prev.map((a) => a.cardId === cardId ? { ...a, lastLog: line, updatedAt: Date.now() } : a)
        );
      },
      onAgentCompleted: (cardId) => {
        setAgentActivities((prev) =>
          prev.map((a) => a.cardId === cardId ? { ...a, status: "completed" as const, updatedAt: Date.now() } : a)
        );
        // Auto-refresh board when agent completes
        fetchBoardRef.current();
      },
      onAgentFailed: (cardId, error) => {
        setAgentActivities((prev) =>
          prev.map((a) => a.cardId === cardId ? { ...a, status: "failed" as const, error, updatedAt: Date.now() } : a)
        );
        fetchBoardRef.current();
      },
    });
    return unsubscribe;
  }, []);

  const fetchBoard = useCallback(async () => {
    setLoadingBoard(true);
    try {
      const data = await api.getBoard(project.id);
      setBoard(data as Board);
    } catch (err) {
      console.error("Failed to fetch board:", err);
      setBoard({ backlog: [], in_progress: [], done: [] });
    } finally {
      setLoadingBoard(false);
    }
  }, [project.id]);

  const fetchDocs = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const data = await api.getProjectDocs(project.id);
      setDocs(data as Doc[]);
    } catch (err) {
      console.error("Failed to fetch docs:", err);
      setDocs([]);
    } finally {
      setLoadingDocs(false);
    }
  }, [project.id]);

  const fetchDecisions = useCallback(async () => {
    setLoadingDecisions(true);
    try {
      const data = await api.getDecisions(project.id);
      setDecisions(data as Decision[]);
    } catch (err) {
      console.error("Failed to fetch decisions:", err);
      setDecisions([]);
    } finally {
      setLoadingDecisions(false);
    }
  }, [project.id]);

  // Keep ref in sync for use inside WS callbacks
  useEffect(() => {
    fetchBoardRef.current = fetchBoard;
  }, [fetchBoard]);

  // Pre-fetch board and docs on mount (docs needed for sidebar)
  useEffect(() => {
    fetchBoard();
    fetchDocs();
  }, [fetchBoard, fetchDocs]);

  useEffect(() => {
    if (activeTab === "board") fetchBoard();
    else if (activeTab === "docs") fetchDocs();
    else if (activeTab === "decisions") fetchDecisions();
  }, [activeTab, fetchBoard, fetchDocs, fetchDecisions]);

  const handleAddCard = useCallback(
    async (title: string) => {
      try {
        await api.createCard(project.id, title);
        fetchBoard();
      } catch (err) {
        console.error("Failed to create card:", err);
      }
    },
    [project.id, fetchBoard]
  );

  const handleCreateDoc = useCallback(
    async (type: string, title: string, content: string) => {
      try {
        await api.createProjectDoc(project.id, type, title, content);
        setShowDocModal(false);
        fetchDocs();
      } catch (err) {
        console.error("Failed to create doc:", err);
      }
    },
    [project.id, fetchDocs]
  );

  return (
    <View style={styles.container}>
      {/* Workspace header */}
      <View style={styles.workspaceHeader}>
        <Pressable
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]}
          onPress={onBack}
        >
          <FontAwesome name="arrow-left" size={16} color={TEXT_PRIMARY} />
        </Pressable>
        <Text style={styles.workspaceTitle} numberOfLines={1}>
          {project.name}
        </Text>
        <Pressable
          style={({ pressed }) => [styles.settingsButton, pressed && { opacity: 0.7 }]}
          onPress={() => setShowSidebar(true)}
        >
          <FontAwesome name="file-text-o" size={16} color={showSidebar ? ACCENT : TEXT_SECONDARY} />
        </Pressable>
      </View>

      {/* Sub-tab bar */}
      <WorkspaceTabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Agent activity */}
      <AgentActivityBar activities={agentActivities} />

      {/* Tab content */}
      <View style={styles.workspaceContent}>
        {activeTab === "board" && (
          <BoardView
            board={board}
            loading={loadingBoard}
            onAddCard={handleAddCard}
            onCardPress={setSelectedCard}
          />
        )}
        {activeTab === "docs" && (
          <DocsView
            docs={docs}
            loading={loadingDocs}
            onCreatePress={() => setShowDocModal(true)}
            onDocPress={setSelectedDoc}
          />
        )}
        {activeTab === "decisions" && (
          <DecisionsView
            decisions={decisions}
            loading={loadingDecisions}
            onDecisionPress={setSelectedDecision}
          />
        )}
      </View>

      {/* Modals */}
      <CreateDocModal
        visible={showDocModal}
        onClose={() => setShowDocModal(false)}
        onCreate={handleCreateDoc}
      />
      <CardDetailModal
        card={selectedCard}
        projectId={project.id}
        onClose={() => setSelectedCard(null)}
        onUpdate={fetchBoard}
        onDelete={fetchBoard}
      />
      <DocDetailModal
        doc={selectedDoc}
        projectId={project.id}
        onClose={() => setSelectedDoc(null)}
        onUpdate={fetchDocs}
      />
      <DecisionDetailModal
        decision={selectedDecision}
        onClose={() => setSelectedDecision(null)}
      />

      {/* Docs sidebar */}
      <DocsSidebar
        visible={showSidebar}
        docs={docs}
        onClose={() => setShowSidebar(false)}
        onDocPress={(doc) => {
          setShowSidebar(false);
          setSelectedDoc(doc);
        }}
        onCreatePress={() => {
          setShowSidebar(false);
          setShowDocModal(true);
        }}
      />
    </View>
  );
}

// ---- Main Screen ----

export default function BuildScreen() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getProjects();
      setProjects(data as Project[]);
    } catch (err) {
      console.error("Failed to fetch projects:", err);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleCreateProject = useCallback(
    async (name: string, description: string) => {
      try {
        await api.createProject(name, description);
        setShowCreateModal(false);
        fetchProjects();
      } catch (err) {
        console.error("Failed to create project:", err);
      }
    },
    [fetchProjects]
  );

  const handleBack = useCallback(() => {
    setSelectedProject(null);
    fetchProjects();
  }, [fetchProjects]);

  if (selectedProject) {
    return <ProjectWorkspaceView project={selectedProject} onBack={handleBack} />;
  }

  return (
    <>
      <ProjectListView
        projects={projects}
        loading={loading}
        onSelect={setSelectedProject}
        onCreatePress={() => setShowCreateModal(true)}
      />
      <CreateProjectModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreateProject}
      />
    </>
  );
}

// ---- Styles ----

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },

  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },

  // ---- Project List ----

  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: BG,
  },

  listTitle: {
    color: TEXT_PRIMARY,
    fontSize: 28,
    fontWeight: "700",
  },

  addProjectBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },

  projectList: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },

  gridItem: {
    flex: 1,
    maxWidth: "50%",
    paddingHorizontal: 4,
  },

  projectTile: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
  },

  projectTilePressed: {
    backgroundColor: SURFACE2,
  },

  tileAccent: {
    height: 3,
  },

  tileBody: {
    padding: 16,
  },

  tileHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },

  tileName: {
    color: TEXT_PRIMARY,
    fontSize: 17,
    fontWeight: "600",
    flex: 1,
    marginRight: 8,
  },

  tileDescription: {
    color: TEXT_SECONDARY,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },

  tileProgress: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    gap: 8,
  },

  tileProgressBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: BORDER,
    overflow: "hidden",
  },

  tileProgressFill: {
    height: 4,
    borderRadius: 2,
  },

  tileProgressLabel: {
    color: TEXT_SECONDARY,
    fontSize: 11,
    fontWeight: "500",
    minWidth: 28,
    textAlign: "right",
  },

  tileStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 8,
  },

  tileStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  tileStatDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  tileStatText: {
    color: TEXT_SECONDARY,
    fontSize: 11,
  },

  tileUpdated: {
    color: TEXT_SECONDARY,
    fontSize: 11,
    opacity: 0.7,
  },

  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  emptyTitle: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: "600",
    marginTop: 16,
  },

  emptySubtitle: {
    color: TEXT_SECONDARY,
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
  },

  // ---- Workspace Header ----

  workspaceHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: SURFACE,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
  },

  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },

  workspaceTitle: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontSize: 18,
    fontWeight: "600",
    marginHorizontal: 8,
  },

  settingsButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },

  // ---- Workspace Tab Bar ----

  workspaceTabBar: {
    backgroundColor: SURFACE,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    paddingHorizontal: 16,
  },

  workspaceTab: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 4,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },

  workspaceTabActive: {
    borderBottomColor: ACCENT,
  },

  workspaceTabText: {
    color: TEXT_SECONDARY,
    fontSize: 14,
    fontWeight: "500",
  },

  workspaceTabTextActive: {
    color: ACCENT,
  },

  workspaceContent: {
    flex: 1,
  },

  // ---- Board ----

  boardContainer: {
    paddingHorizontal: 12,
    paddingVertical: 16,
  },

  boardColumn: {
    width: 280,
    backgroundColor: SURFACE,
    borderRadius: 12,
    marginHorizontal: 6,
    maxHeight: "100%",
    borderWidth: 1,
    borderColor: BORDER,
  },

  columnHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
  },

  columnTitle: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  columnCount: {
    backgroundColor: SURFACE2,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: "center",
  },

  columnCountText: {
    color: TEXT_SECONDARY,
    fontSize: 12,
    fontWeight: "600",
  },

  columnCards: {
    flex: 1,
  },

  columnCardsContent: {
    padding: 10,
    paddingBottom: 16,
  },

  card: {
    backgroundColor: SURFACE2,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },

  cardTitle: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 19,
  },

  cardDescription: {
    color: TEXT_SECONDARY,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 17,
  },

  cardLabels: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
    gap: 4,
  },

  labelPill: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },

  labelText: {
    fontSize: 11,
    fontWeight: "500",
  },

  addCardBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderStyle: "dashed",
    marginTop: 4,
  },

  addCardText: {
    color: TEXT_SECONDARY,
    fontSize: 13,
    marginLeft: 6,
  },

  addCardInput: {
    backgroundColor: SURFACE2,
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
    borderWidth: 1,
    borderColor: ACCENT,
  },

  addCardTextInput: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    padding: 0,
    marginBottom: 8,
  },

  addCardActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  addCardConfirm: {
    backgroundColor: ACCENT,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },

  addCardConfirmText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },

  // ---- Docs ----

  docsContainer: {
    flex: 1,
  },

  docsContent: {
    padding: 16,
    paddingBottom: 32,
  },

  docsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },

  docsTitle: {
    color: TEXT_PRIMARY,
    fontSize: 18,
    fontWeight: "600",
  },

  addDocBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },

  docGroup: {
    marginBottom: 20,
  },

  docGroupTitle: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },

  docCard: {
    backgroundColor: SURFACE,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },

  docCardTitle: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: "500",
  },

  docCardPreview: {
    color: TEXT_SECONDARY,
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },

  emptySection: {
    alignItems: "center",
    paddingVertical: 40,
  },

  emptySectionText: {
    color: TEXT_SECONDARY,
    fontSize: 14,
    marginTop: 12,
  },

  // ---- Decisions ----

  decisionsList: {
    padding: 16,
    paddingBottom: 32,
  },

  decisionCard: {
    backgroundColor: SURFACE,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },

  decisionTitle: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: "600",
  },

  decisionReasoning: {
    color: TEXT_SECONDARY,
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
  },

  decisionMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
  },

  decisionTimestamp: {
    color: TEXT_SECONDARY,
    fontSize: 11,
    opacity: 0.7,
  },

  alternativesBadge: {
    backgroundColor: ACCENT + "22",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 10,
  },

  alternativesBadgeText: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: "500",
  },

  // ---- Modals ----

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },

  modalCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },

  modalContent: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 24,
    width: "90%",
    maxWidth: 420,
    borderWidth: 1,
    borderColor: BORDER,
  },

  modalTitle: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 16,
  },

  modalLabel: {
    color: TEXT_SECONDARY,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },

  modalInput: {
    backgroundColor: BG,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    color: TEXT_PRIMARY,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },

  modalInputMultiline: {
    minHeight: 70,
    textAlignVertical: "top",
  },

  modalInputLarge: {
    minHeight: 120,
    textAlignVertical: "top",
  },

  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
    gap: 10,
  },

  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },

  modalCancelText: {
    color: TEXT_SECONDARY,
    fontSize: 15,
    fontWeight: "500",
  },

  modalCreateBtn: {
    backgroundColor: ACCENT,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },

  modalCreateBtnDisabled: {
    opacity: 0.4,
  },

  modalCreateText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },

  // ---- Doc Type Picker ----

  docTypePicker: {
    marginBottom: 12,
    maxHeight: 40,
  },

  docTypeChip: {
    backgroundColor: SURFACE2,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },

  docTypeChipActive: {
    backgroundColor: ACCENT + "22",
    borderColor: ACCENT,
  },

  docTypeChipText: {
    color: TEXT_SECONDARY,
    fontSize: 13,
    fontWeight: "500",
  },

  docTypeChipTextActive: {
    color: ACCENT,
  },

  // ---- Detail Modals ----

  modalContentTall: {
    maxHeight: "80%",
  },

  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },

  detailLabels: {
    marginTop: 8,
    marginBottom: 8,
  },

  detailTimestamp: {
    color: TEXT_SECONDARY,
    fontSize: 11,
    opacity: 0.7,
    marginTop: 8,
    marginBottom: 4,
  },

  detailSection: {
    marginTop: 16,
  },

  detailSectionTitle: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },

  detailSectionContent: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    lineHeight: 20,
  },

  docDetailType: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
  },

  alternativeItem: {
    flexDirection: "row",
    marginBottom: 6,
    paddingLeft: 4,
  },

  alternativeBullet: {
    color: TEXT_SECONDARY,
    fontSize: 14,
    marginRight: 8,
    lineHeight: 20,
  },

  alternativeText: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },

  // ---- Agent Activity Bar ----

  agentBar: {
    backgroundColor: SURFACE,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },

  agentBarItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 2,
  },

  agentBarDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },

  agentBarText: {
    color: TEXT_SECONDARY,
    fontSize: 12,
    flex: 1,
  },

  // ---- Pressed States ----

  cardPressed: {
    backgroundColor: BORDER,
  },

  docCardPressed: {
    backgroundColor: SURFACE2,
  },

  decisionCardPressed: {
    backgroundColor: SURFACE2,
  },

  // ---- Docs Sidebar ----

  sidebarOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
    zIndex: 10,
  },

  sidebar: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: SIDEBAR_WIDTH,
    backgroundColor: SURFACE,
    borderLeftWidth: 1,
    borderLeftColor: BORDER,
    zIndex: 11,
    shadowColor: "#000",
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },

  sidebarHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
  },

  sidebarTitle: {
    color: TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: "600",
  },

  sidebarHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  sidebarAddBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },

  sidebarCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },

  sidebarContent: {
    flex: 1,
  },

  sidebarContentInner: {
    padding: 12,
    paddingBottom: 24,
  },

  sidebarEmpty: {
    alignItems: "center",
    paddingVertical: 40,
    paddingHorizontal: 20,
  },

  sidebarEmptyText: {
    color: TEXT_SECONDARY,
    fontSize: 14,
    marginTop: 10,
  },

  sidebarEmptyHint: {
    color: TEXT_SECONDARY,
    fontSize: 12,
    textAlign: "center",
    marginTop: 6,
    opacity: 0.7,
    lineHeight: 17,
  },

  sidebarDocGroup: {
    marginBottom: 16,
  },

  sidebarDocGroupTitle: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
    paddingHorizontal: 4,
  },

  sidebarDocItem: {
    backgroundColor: SURFACE2,
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: BORDER,
  },

  sidebarDocItemPressed: {
    backgroundColor: BORDER,
  },

  sidebarDocTitle: {
    color: TEXT_PRIMARY,
    fontSize: 13,
    fontWeight: "500",
  },

  sidebarDocPreview: {
    color: TEXT_SECONDARY,
    fontSize: 11,
    marginTop: 2,
  },
});
