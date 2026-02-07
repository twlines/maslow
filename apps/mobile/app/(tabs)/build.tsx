import React, { useState, useEffect, useCallback } from "react";
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
} from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { api } from "../../services/api";

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

const LABEL_COLORS = ["#7C5CFC", "#34D399", "#F87171", "#FBBF24", "#60A5FA", "#A78BFA"];

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

/** ProjectListView - shows all projects */
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
  const renderProject = ({ item }: { item: Project }) => (
    <Pressable
      style={({ pressed }) => [styles.projectCard, pressed && styles.projectCardPressed]}
      onPress={() => onSelect(item)}
    >
      <View style={styles.projectCardHeader}>
        <View style={styles.projectCardLeft}>
          <View
            style={[
              styles.projectColorBar,
              { backgroundColor: item.color || ACCENT },
            ]}
          />
          <Text style={styles.projectName} numberOfLines={1}>
            {item.name}
          </Text>
        </View>
        <StatusDot status={item.status} />
      </View>
      {item.description ? (
        <Text style={styles.projectDescription} numberOfLines={1}>
          {item.description}
        </Text>
      ) : null}
      <Text style={styles.projectUpdated}>{relativeTime(item.updatedAt)}</Text>
    </Pressable>
  );

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
          renderItem={renderProject}
          keyExtractor={(item) => item.id}
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
}: {
  title: string;
  cards: Card[];
  showAddCard?: boolean;
  onAddCard?: (title: string) => void;
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
          <View key={card.id} style={styles.card}>
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
          </View>
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
}: {
  board: Board | null;
  loading: boolean;
  onAddCard: (title: string) => void;
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
      <BoardColumn title="Backlog" cards={board.backlog} showAddCard onAddCard={onAddCard} />
      <BoardColumn title="In Progress" cards={board.in_progress} />
      <BoardColumn title="Done" cards={board.done} />
    </ScrollView>
  );
}

/** DocsView - project documents grouped by type */
function DocsView({
  docs,
  loading,
  onCreatePress,
}: {
  docs: Doc[];
  loading: boolean;
  onCreatePress: () => void;
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
                <View key={doc.id} style={styles.docCard}>
                  <Text style={styles.docCardTitle}>{doc.title}</Text>
                  <Text style={styles.docCardPreview} numberOfLines={2}>
                    {truncate(doc.content, 80)}
                  </Text>
                </View>
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
}: {
  decisions: Decision[];
  loading: boolean;
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
        <View style={styles.decisionCard}>
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
        </View>
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
        <Pressable style={({ pressed }) => [styles.settingsButton, pressed && { opacity: 0.7 }]}>
          <FontAwesome name="cog" size={16} color={TEXT_SECONDARY} />
        </Pressable>
      </View>

      {/* Sub-tab bar */}
      <WorkspaceTabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab content */}
      <View style={styles.workspaceContent}>
        {activeTab === "board" && (
          <BoardView board={board} loading={loadingBoard} onAddCard={handleAddCard} />
        )}
        {activeTab === "docs" && (
          <DocsView
            docs={docs}
            loading={loadingDocs}
            onCreatePress={() => setShowDocModal(true)}
          />
        )}
        {activeTab === "decisions" && (
          <DecisionsView decisions={decisions} loading={loadingDecisions} />
        )}
      </View>

      {/* Doc creation modal */}
      <CreateDocModal
        visible={showDocModal}
        onClose={() => setShowDocModal(false)}
        onCreate={handleCreateDoc}
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

  projectCard: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },

  projectCardPressed: {
    backgroundColor: SURFACE2,
  },

  projectCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },

  projectCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 12,
  },

  projectColorBar: {
    width: 4,
    height: 20,
    borderRadius: 2,
    marginRight: 10,
  },

  projectName: {
    color: TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
  },

  projectDescription: {
    color: TEXT_SECONDARY,
    fontSize: 13,
    marginTop: 4,
    marginLeft: 14,
  },

  projectUpdated: {
    color: TEXT_SECONDARY,
    fontSize: 11,
    marginTop: 8,
    marginLeft: 14,
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
});
