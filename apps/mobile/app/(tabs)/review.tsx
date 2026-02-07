import React, { useState, useEffect, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { api } from "../../services/api";

// --- Theme ---
const BG = "#0F0F0F";
const SURFACE = "#1A1A1A";
const TEXT_PRIMARY = "#E5E5E5";
const TEXT_SECONDARY = "#999999";
const ACCENT = "#7C5CFC";
const BORDER = "#333333";
const DECISION_AMBER = "#F59E0B";

// --- Types ---
interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  color?: string;
}

interface Message {
  id: string;
  projectId: string;
  role: string;
  content: string;
  timestamp: string;
  metadata?: { cost?: number; [key: string]: any };
}

interface Decision {
  id: string;
  projectId: string;
  title: string;
  description: string;
  alternatives: string;
  reasoning: string;
  tradeoffs: string;
  createdAt: string;
  revisedAt?: string;
}

type TimelineItem =
  | { type: "message"; data: Message; sortTime: number }
  | { type: "decision"; data: Decision; sortTime: number };

// --- Helpers ---

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return dateStr;

  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;

  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function truncate(text: string, maxLen: number): string {
  if (!text) return "";
  const clean = text.replace(/\n/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen).trim() + "...";
}

// --- Components ---

function ProjectFilterBar({
  projects,
  selectedId,
  onSelect,
}: {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <View style={styles.filterBar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterBarContent}
      >
        <Pressable
          onPress={() => onSelect(null)}
          style={[styles.filterPill, selectedId === null && styles.filterPillActive]}
        >
          <Text
            style={[
              styles.filterPillText,
              selectedId === null && styles.filterPillTextActive,
            ]}
          >
            All
          </Text>
        </Pressable>
        {projects.map((project) => (
          <Pressable
            key={project.id}
            onPress={() => onSelect(project.id)}
            style={[
              styles.filterPill,
              selectedId === project.id && styles.filterPillActive,
            ]}
          >
            <Text
              style={[
                styles.filterPillText,
                selectedId === project.id && styles.filterPillTextActive,
              ]}
            >
              {project.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function MessageCard({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const accentColor = isUser ? ACCENT : TEXT_SECONDARY;
  const roleLabel = isUser ? "You" : "Maslow";
  const cost = message.metadata?.cost;

  return (
    <View style={styles.card}>
      <View style={[styles.cardAccentBar, { backgroundColor: accentColor }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <Text style={[styles.roleLabel, { color: accentColor }]}>{roleLabel}</Text>
          <Text style={styles.timestamp}>{relativeTime(message.timestamp)}</Text>
        </View>
        <Text style={styles.contentPreview}>{truncate(message.content, 120)}</Text>
        {cost != null && (
          <Text style={styles.costLabel}>
            <FontAwesome name="bolt" size={10} color={TEXT_SECONDARY} /> {cost.toFixed(4)}
          </Text>
        )}
      </View>
    </View>
  );
}

function DecisionCard({ decision }: { decision: Decision }) {
  return (
    <View style={styles.card}>
      <View style={[styles.cardAccentBar, { backgroundColor: DECISION_AMBER }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <View style={styles.decisionLabelRow}>
            <FontAwesome name="legal" size={11} color={DECISION_AMBER} />
            <Text style={[styles.roleLabel, { color: DECISION_AMBER, marginLeft: 6 }]}>
              Decision
            </Text>
          </View>
          <Text style={styles.timestamp}>{relativeTime(decision.createdAt)}</Text>
        </View>
        <Text style={styles.decisionTitle}>{decision.title}</Text>
        <Text style={styles.contentPreview}>{truncate(decision.reasoning, 100)}</Text>
      </View>
    </View>
  );
}

function EmptyState() {
  return (
    <View style={styles.emptyState}>
      <FontAwesome name="clock-o" size={48} color={ACCENT} style={{ opacity: 0.5 }} />
      <Text style={styles.emptyTitle}>No activity yet</Text>
      <Text style={styles.emptySubtitle}>
        Conversations, decisions, and milestones{"\n"}will appear here as you work.
      </Text>
    </View>
  );
}

// --- Main Screen ---

export default function ReviewScreen() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        // Always fetch projects for the filter bar
        let fetchedProjects = projects;
        if (!isRefresh || projects.length === 0) {
          try {
            fetchedProjects = await api.getProjects();
            setProjects(fetchedProjects);
          } catch {
            // Projects endpoint may fail if none exist yet
            fetchedProjects = [];
            setProjects([]);
          }
        }

        // Fetch messages
        let messages: Message[] = [];
        try {
          messages = await api.getMessages(
            selectedProjectId ?? undefined,
            50
          );
        } catch {
          messages = [];
        }

        // Fetch decisions
        let decisions: Decision[] = [];
        try {
          if (selectedProjectId) {
            decisions = await api.getDecisions(selectedProjectId);
          } else {
            // Fetch decisions across all projects
            const results = await Promise.allSettled(
              fetchedProjects.map((p) => api.getDecisions(p.id))
            );
            for (const result of results) {
              if (result.status === "fulfilled") {
                decisions.push(...result.value);
              }
            }
          }
        } catch {
          decisions = [];
        }

        // Merge into timeline
        const items: TimelineItem[] = [];

        for (const msg of messages) {
          items.push({
            type: "message",
            data: msg,
            sortTime: new Date(msg.timestamp).getTime(),
          });
        }

        for (const dec of decisions) {
          items.push({
            type: "decision",
            data: dec,
            sortTime: new Date(dec.createdAt).getTime(),
          });
        }

        // Sort newest first
        items.sort((a, b) => b.sortTime - a.sortTime);

        setTimeline(items);
      } catch {
        // Silently handle unexpected errors
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedProjectId, projects]
  );

  // Fetch on mount and when selected project changes
  useEffect(() => {
    fetchData();
  }, [selectedProjectId]); // eslint-disable-line

  const handleRefresh = useCallback(() => {
    fetchData(true);
  }, [fetchData]);

  const renderItem = useCallback(({ item }: { item: TimelineItem }) => {
    if (item.type === "decision") {
      return <DecisionCard decision={item.data as Decision} />;
    }
    return <MessageCard message={item.data as Message} />;
  }, []);

  const keyExtractor = useCallback((item: TimelineItem) => {
    return `${item.type}-${item.data.id}`;
  }, []);

  return (
    <View style={styles.container}>
      <ProjectFilterBar
        projects={projects}
        selectedId={selectedProjectId}
        onSelect={setSelectedProjectId}
      />

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={ACCENT} />
        </View>
      ) : timeline.length === 0 ? (
        <EmptyState />
      ) : (
        <FlatList
          data={timeline}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={ACCENT}
              colors={[ACCENT]}
            />
          }
        />
      )}
    </View>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },

  // Filter bar
  filterBar: {
    backgroundColor: SURFACE,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    paddingVertical: 10,
  },
  filterBarContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  filterPillActive: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  filterPillText: {
    color: TEXT_SECONDARY,
    fontSize: 13,
    fontWeight: "500",
  },
  filterPillTextActive: {
    color: "#FFFFFF",
  },

  // Loading
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  // List
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },

  // Card shared
  card: {
    flexDirection: "row",
    backgroundColor: SURFACE,
    borderRadius: 10,
    marginBottom: 10,
    overflow: "hidden",
  },
  cardAccentBar: {
    width: 3,
  },
  cardBody: {
    flex: 1,
    padding: 14,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  roleLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  timestamp: {
    fontSize: 11,
    color: TEXT_SECONDARY,
  },
  contentPreview: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    lineHeight: 20,
  },

  // Message-specific
  costLabel: {
    color: TEXT_SECONDARY,
    fontSize: 11,
    marginTop: 6,
  },

  // Decision-specific
  decisionLabelRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  decisionTitle: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },

  // Empty state
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
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
});
