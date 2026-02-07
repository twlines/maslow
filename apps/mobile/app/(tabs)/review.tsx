import React, { useState, useEffect, useCallback } from "react"
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native"
import FontAwesome from "@expo/vector-icons/FontAwesome"
import { api } from "../../services/api"

// --- Theme ---
const BG = "#0F0F0F"
const SURFACE = "#1A1A1A"
const TEXT_PRIMARY = "#E5E5E5"
const TEXT_SECONDARY = "#999999"
const ACCENT = "#7C5CFC"
const BORDER = "#333333"
const DECISION_AMBER = "#F59E0B"
const CONVERSATION_TEAL = "#34D399"
const ASSUMPTION_ROSE = "#F472B6"
const CONNECTION_BLUE = "#60A5FA"

// --- Types ---
interface Project {
  id: string
  name: string
  description: string
  status: string
  color?: string
}

interface Conversation {
  id: string
  projectId: string | null
  status: string
  summary: string | null
  messageCount: number
  firstMessageAt: number
  lastMessageAt: number
}

interface Decision {
  id: string
  projectId: string
  title: string
  description: string
  alternatives: string
  reasoning: string
  tradeoffs: string
  createdAt: string
  revisedAt?: string
}

interface Message {
  id: string
  projectId: string
  role: string
  content: string
  timestamp: string
  metadata?: { cost?: number; voiceNote?: boolean }
}

interface Assumption {
  id: string
  projectId: string
  text: string
  updatedAt: number
}

interface Connection {
  type: "shared_pattern" | "contradiction" | "reusable_work"
  projects: string[]
  description: string
}

type TimelineItem =
  | { type: "conversation"; data: Conversation; sortTime: number }
  | { type: "decision"; data: Decision; sortTime: number }
  | { type: "message"; data: Message; sortTime: number }
  | { type: "assumption"; data: Assumption; sortTime: number }

// --- Helpers ---

function relativeTime(ts: string | number): string {
  const now = Date.now()
  const then = typeof ts === "number" ? ts : new Date(ts).getTime()
  if (isNaN(then)) return String(ts)

  const diffMs = now - then
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffSec < 60) return "Just now"
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay === 1) return "Yesterday"
  if (diffDay < 7) return `${diffDay}d ago`

  const d = new Date(then)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function truncate(text: string, maxLen: number): string {
  if (!text) return ""
  const clean = text.replace(/\n/g, " ").trim()
  if (clean.length <= maxLen) return clean
  return clean.slice(0, maxLen).trim() + "..."
}

function firstSentence(text: string): string {
  if (!text) return ""
  const clean = text.replace(/\n/g, " ").trim()
  const match = clean.match(/^[^.!?]*[.!?]/)
  return match ? match[0].trim() : truncate(clean, 100)
}

// --- Components ---

function ProjectFilterBar({
  projects,
  selectedId,
  onSelect,
}: {
  projects: Project[]
  selectedId: string | null
  onSelect: (id: string | null) => void
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
  )
}

function ConversationCard({ conversation }: { conversation: Conversation }) {
  const [expanded, setExpanded] = useState(false)
  const shortSummary = conversation.summary
    ? firstSentence(conversation.summary)
    : `${conversation.messageCount} messages`
  const fullSummary = conversation.summary || shortSummary
  const canExpand = conversation.summary && conversation.summary.length > shortSummary.length

  return (
    <Pressable onPress={() => canExpand && setExpanded(!expanded)}>
      <View style={styles.card}>
        <View style={[styles.cardAccentBar, { backgroundColor: CONVERSATION_TEAL }]} />
        <View style={styles.cardBody}>
          <View style={styles.cardHeader}>
            <View style={styles.decisionLabelRow}>
              <FontAwesome name="comments-o" size={11} color={CONVERSATION_TEAL} />
              <Text style={[styles.roleLabel, { color: CONVERSATION_TEAL, marginLeft: 6 }]}>
                Conversation
              </Text>
            </View>
            <View style={styles.decisionLabelRow}>
              <Text style={styles.timestamp}>{relativeTime(conversation.lastMessageAt)}</Text>
              {canExpand && (
                <FontAwesome
                  name={expanded ? "chevron-up" : "chevron-down"}
                  size={10}
                  color={TEXT_SECONDARY}
                  style={{ marginLeft: 6 }}
                />
              )}
            </View>
          </View>
          <Text style={styles.contentPreview}>
            {expanded ? fullSummary : shortSummary}
          </Text>
          <Text style={styles.costLabel}>
            {conversation.messageCount} messages
          </Text>
        </View>
      </View>
    </Pressable>
  )
}

function MessageCard({ message }: { message: Message }) {
  const isUser = message.role === "user"
  const accentColor = isUser ? ACCENT : TEXT_SECONDARY
  const roleLabel = isUser ? "You" : "Maslow"
  const isVoice = message.metadata?.voiceNote

  return (
    <View style={styles.card}>
      <View style={[styles.cardAccentBar, { backgroundColor: accentColor }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <View style={styles.decisionLabelRow}>
            {isVoice && (
              <FontAwesome name="microphone" size={10} color={accentColor} style={{ marginRight: 4 }} />
            )}
            <Text style={[styles.roleLabel, { color: accentColor }]}>{roleLabel}</Text>
          </View>
          <Text style={styles.timestamp}>{relativeTime(message.timestamp)}</Text>
        </View>
        <Text style={styles.contentPreview}>{truncate(message.content, 120)}</Text>
      </View>
    </View>
  )
}

function DecisionCard({ decision }: { decision: Decision }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = decision.reasoning && decision.reasoning.length > 100

  const alternatives = Array.isArray(decision.alternatives)
    ? decision.alternatives
    : typeof decision.alternatives === "string" && decision.alternatives
      ? [decision.alternatives]
      : []

  return (
    <Pressable onPress={() => hasDetail && setExpanded(!expanded)}>
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
            <View style={styles.decisionLabelRow}>
              <Text style={styles.timestamp}>{relativeTime(decision.createdAt)}</Text>
              {hasDetail && (
                <FontAwesome
                  name={expanded ? "chevron-up" : "chevron-down"}
                  size={10}
                  color={TEXT_SECONDARY}
                  style={{ marginLeft: 6 }}
                />
              )}
            </View>
          </View>
          <Text style={styles.decisionTitle}>{decision.title}</Text>
          <Text style={styles.contentPreview}>
            {expanded ? decision.reasoning : truncate(decision.reasoning, 100)}
          </Text>
          {expanded && alternatives.length > 0 && (
            <View style={styles.expandedAlternatives}>
              <Text style={styles.expandedLabel}>Alternatives considered:</Text>
              {alternatives.map((alt, i) => (
                <Text key={i} style={styles.expandedAltText}>- {alt}</Text>
              ))}
            </View>
          )}
          {expanded && decision.tradeoffs ? (
            <View style={styles.expandedAlternatives}>
              <Text style={styles.expandedLabel}>Tradeoffs:</Text>
              <Text style={styles.contentPreview}>{decision.tradeoffs}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  )
}

function AssumptionCard({ assumption }: { assumption: Assumption }) {
  return (
    <View style={styles.card}>
      <View style={[styles.cardAccentBar, { backgroundColor: ASSUMPTION_ROSE }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <View style={styles.decisionLabelRow}>
            <FontAwesome name="question-circle-o" size={11} color={ASSUMPTION_ROSE} />
            <Text style={[styles.roleLabel, { color: ASSUMPTION_ROSE, marginLeft: 6 }]}>
              Assumption
            </Text>
          </View>
          <Text style={styles.timestamp}>{relativeTime(assumption.updatedAt)}</Text>
        </View>
        <Text style={styles.contentPreview}>{assumption.text}</Text>
      </View>
    </View>
  )
}

function ConnectionCard({ connection }: { connection: Connection }) {
  const icons: Record<string, string> = {
    shared_pattern: "link",
    contradiction: "exchange",
    reusable_work: "recycle",
  }
  const labels: Record<string, string> = {
    shared_pattern: "Shared Pattern",
    contradiction: "Contradiction",
    reusable_work: "Reusable Work",
  }

  return (
    <View style={styles.connectionCard}>
      <View style={styles.connectionIcon}>
        <FontAwesome name={(icons[connection.type] || "link") as "link"} size={12} color={CONNECTION_BLUE} />
      </View>
      <View style={styles.connectionBody}>
        <View style={styles.connectionHeader}>
          <Text style={styles.connectionLabel}>{labels[connection.type] || connection.type}</Text>
          <Text style={styles.connectionProjects}>{connection.projects.join(" + ")}</Text>
        </View>
        <Text style={styles.connectionDescription}>{connection.description}</Text>
      </View>
    </View>
  )
}

function ConnectionsSection({ connections }: { connections: Connection[] }) {
  if (connections.length === 0) return null

  return (
    <View style={styles.connectionsSection}>
      <View style={styles.connectionsSectionHeader}>
        <FontAwesome name="sitemap" size={12} color={CONNECTION_BLUE} />
        <Text style={styles.connectionsSectionTitle}>Cross-Project Connections</Text>
      </View>
      {connections.map((conn, i) => (
        <ConnectionCard key={i} connection={conn} />
      ))}
    </View>
  )
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
  )
}

// --- Main Screen ---

type ViewMode = "all" | "decisions" | "assumptions"

function ViewModeBar({
  mode,
  onModeChange,
  decisionCount,
  assumptionCount,
}: {
  mode: ViewMode
  onModeChange: (mode: ViewMode) => void
  decisionCount: number
  assumptionCount: number
}) {
  const modes: { key: ViewMode; label: string; icon: string; count?: number }[] = [
    { key: "all", label: "Timeline", icon: "clock-o" },
    { key: "decisions", label: "Decisions", icon: "gavel", count: decisionCount },
    { key: "assumptions", label: "Assumptions", icon: "question-circle-o", count: assumptionCount },
  ]

  return (
    <View style={styles.viewModeBar}>
      {modes.map((m) => (
        <Pressable
          key={m.key}
          style={[styles.viewModeTab, mode === m.key && styles.viewModeTabActive]}
          onPress={() => onModeChange(m.key)}
        >
          <FontAwesome
            name={m.icon as "home"}
            size={12}
            color={mode === m.key ? ACCENT : TEXT_SECONDARY}
          />
          <Text style={[styles.viewModeText, mode === m.key && styles.viewModeTextActive]}>
            {m.label}
          </Text>
          {m.count != null && m.count > 0 && (
            <View style={[styles.viewModeBadge, mode === m.key && styles.viewModeBadgeActive]}>
              <Text style={[styles.viewModeBadgeText, mode === m.key && styles.viewModeBadgeTextActive]}>
                {m.count}
              </Text>
            </View>
          )}
        </Pressable>
      ))}
    </View>
  )
}

export default function ReviewScreen() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>("all")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchData = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      try {
        // Fetch projects for filter bar
        let fetchedProjects = projects
        if (!isRefresh || projects.length === 0) {
          try {
            fetchedProjects = await api.getProjects()
            setProjects(fetchedProjects)
          } catch {
            fetchedProjects = []
            setProjects([])
          }
        }

        // Fetch archived conversations (these replace raw messages in the timeline)
        let conversations: Conversation[] = []
        try {
          conversations = await api.getConversations(selectedProjectId ?? undefined, 20)
        } catch {
          conversations = []
        }

        // Only show archived conversations with summaries as conversation cards
        const archivedConversations = conversations.filter(
          (c) => c.status === "archived" && c.summary
        )

        // Fetch recent messages from the active conversation only (not archived ones)
        let recentMessages: Message[] = []
        try {
          recentMessages = await api.getMessages(selectedProjectId ?? undefined, 20)
          // Filter out system-like messages (action blocks, tool results)
          recentMessages = recentMessages.filter(
            (m) => m.content && !m.content.startsWith("[") && m.content.length > 0
          )
        } catch {
          recentMessages = []
        }

        // Fetch decisions
        let decisions: Decision[] = []
        try {
          if (selectedProjectId) {
            decisions = await api.getDecisions(selectedProjectId)
          } else {
            const results = await Promise.allSettled(
              fetchedProjects.map((p) => api.getDecisions(p.id))
            )
            for (const result of results) {
              if (result.status === "fulfilled") {
                decisions.push(...result.value)
              }
            }
          }
        } catch {
          decisions = []
        }

        // Fetch assumptions from project docs
        let assumptions: Assumption[] = []
        try {
          const projectIds = selectedProjectId
            ? [selectedProjectId]
            : fetchedProjects.map((p) => p.id)
          const docResults = await Promise.allSettled(
            projectIds.map((pid) => api.getProjectDocs(pid))
          )
          for (const result of docResults) {
            if (result.status !== "fulfilled") continue
            const docs = result.value as Array<{ id: string; projectId: string; type: string; content: string; updatedAt: number }>
            const assumptionDoc = docs.find((d) => d.type === "assumptions")
            if (assumptionDoc && assumptionDoc.content) {
              const lines = assumptionDoc.content
                .split("\n")
                .map((l) => l.replace(/^[-•*]\s*/, "").trim())
                .filter((l) => l.length > 0)
              for (let i = 0; i < lines.length; i++) {
                assumptions.push({
                  id: `${assumptionDoc.id}-${i}`,
                  projectId: assumptionDoc.projectId,
                  text: lines[i],
                  updatedAt: assumptionDoc.updatedAt,
                })
              }
            }
          }
        } catch {
          assumptions = []
        }

        // Build timeline
        const items: TimelineItem[] = []

        for (const conv of archivedConversations) {
          items.push({
            type: "conversation",
            data: conv,
            sortTime: conv.lastMessageAt,
          })
        }

        for (const msg of recentMessages) {
          const msgTime = typeof msg.timestamp === "number"
            ? msg.timestamp
            : new Date(msg.timestamp).getTime()
          items.push({
            type: "message",
            data: msg,
            sortTime: msgTime,
          })
        }

        for (const dec of decisions) {
          items.push({
            type: "decision",
            data: dec,
            sortTime: new Date(dec.createdAt).getTime(),
          })
        }

        for (const assumption of assumptions) {
          items.push({
            type: "assumption",
            data: assumption,
            sortTime: assumption.updatedAt,
          })
        }

        // Sort newest first
        items.sort((a, b) => b.sortTime - a.sortTime)

        setTimeline(items)

        // Fetch cross-project connections (only when viewing all)
        if (!selectedProjectId) {
          try {
            const conns = await api.getConnections()
            setConnections(conns)
          } catch {
            setConnections([])
          }
        } else {
          setConnections([])
        }
      } catch {
        // Silently handle unexpected errors
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [selectedProjectId, projects]
  )

  useEffect(() => {
    fetchData()
  }, [selectedProjectId, fetchData])

  const handleRefresh = useCallback(() => {
    fetchData(true)
  }, [fetchData])

  const renderItem = useCallback(({ item }: { item: TimelineItem }) => {
    if (item.type === "conversation") {
      return <ConversationCard conversation={item.data as Conversation} />
    }
    if (item.type === "decision") {
      return <DecisionCard decision={item.data as Decision} />
    }
    if (item.type === "assumption") {
      return <AssumptionCard assumption={item.data as Assumption} />
    }
    return <MessageCard message={item.data as Message} />
  }, [])

  const keyExtractor = useCallback((item: TimelineItem) => {
    return `${item.type}-${item.data.id}`
  }, [])

  // Filter based on view mode
  const filteredTimeline = viewMode === "all"
    ? timeline
    : timeline.filter((item) => item.type === (viewMode === "decisions" ? "decision" : "assumption"))

  const decisionCount = timeline.filter((i) => i.type === "decision").length
  const assumptionCount = timeline.filter((i) => i.type === "assumption").length

  return (
    <View style={styles.container}>
      <ProjectFilterBar
        projects={projects}
        selectedId={selectedProjectId}
        onSelect={setSelectedProjectId}
      />
      <ViewModeBar
        mode={viewMode}
        onModeChange={setViewMode}
        decisionCount={decisionCount}
        assumptionCount={assumptionCount}
      />

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={ACCENT} />
        </View>
      ) : filteredTimeline.length === 0 ? (
        <EmptyState />
      ) : (
        <FlatList
          data={filteredTimeline}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            viewMode === "all" && connections.length > 0
              ? <ConnectionsSection connections={connections} />
              : null
          }
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
  )
}

// --- Styles ---

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
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
  viewModeBar: {
    flexDirection: "row",
    backgroundColor: SURFACE,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    paddingHorizontal: 8,
  },
  viewModeTab: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  viewModeTabActive: {
    borderBottomColor: ACCENT,
  },
  viewModeText: {
    color: TEXT_SECONDARY,
    fontSize: 12,
    fontWeight: "500",
  },
  viewModeTextActive: {
    color: ACCENT,
  },
  viewModeBadge: {
    backgroundColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: "center",
  },
  viewModeBadgeActive: {
    backgroundColor: ACCENT + "22",
  },
  viewModeBadgeText: {
    color: TEXT_SECONDARY,
    fontSize: 10,
    fontWeight: "600",
  },
  viewModeBadgeTextActive: {
    color: ACCENT,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
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
  costLabel: {
    color: TEXT_SECONDARY,
    fontSize: 11,
    marginTop: 6,
  },
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
  expandedAlternatives: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: BORDER,
  },
  expandedLabel: {
    color: TEXT_SECONDARY,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  expandedAltText: {
    color: TEXT_PRIMARY,
    fontSize: 13,
    lineHeight: 18,
    paddingLeft: 4,
  },

  // Connections
  connectionsSection: {
    marginBottom: 16,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CONNECTION_BLUE + "33",
    overflow: "hidden",
  },
  connectionsSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    gap: 8,
  },
  connectionsSectionTitle: {
    color: CONNECTION_BLUE,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  connectionCard: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
  },
  connectionIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: CONNECTION_BLUE + "22",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  connectionBody: {
    flex: 1,
  },
  connectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  connectionLabel: {
    color: CONNECTION_BLUE,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  connectionProjects: {
    color: TEXT_SECONDARY,
    fontSize: 11,
  },
  connectionDescription: {
    color: TEXT_PRIMARY,
    fontSize: 13,
    lineHeight: 18,
  },
})
