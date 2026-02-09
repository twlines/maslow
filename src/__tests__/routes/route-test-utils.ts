/**
 * Route test utilities
 *
 * Mock ServerResponse and service factories for testing route handlers.
 */

import { Effect } from "effect"
import type { ServerResponse } from "http"
import type { AppPersistenceService, AppProject, AppProjectDocument, AppKanbanCard, AppDecision } from "../../services/AppPersistence.js"
import type { KanbanService } from "../../services/Kanban.js"
import type { ThinkingPartnerService } from "../../services/ThinkingPartner.js"

export interface MockResponse {
  status: number
  headers: Record<string, string | number>
  body: unknown
  ended: boolean
}

export function createMockRes(): ServerResponse & { _mock: MockResponse } {
  const mock: MockResponse = {
    status: 0,
    headers: {},
    body: null,
    ended: false,
  }

  const res = {
    _mock: mock,
    writeHead(status: number, headers: Record<string, string | number>) {
      mock.status = status
      mock.headers = headers
      return res
    },
    end(data?: string) {
      mock.ended = true
      if (data) {
        try {
          mock.body = JSON.parse(data)
        } catch {
          mock.body = data
        }
      }
      return res
    },
  } as unknown as ServerResponse & { _mock: MockResponse }

  return res
}

export function makeProject(overrides: Partial<AppProject> = {}): AppProject {
  return {
    id: "proj-1",
    name: "Test Project",
    description: "A test project",
    status: "active",
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  }
}

export function makeDocument(overrides: Partial<AppProjectDocument> = {}): AppProjectDocument {
  return {
    id: "doc-1",
    projectId: "proj-1",
    type: "brief",
    title: "Test Doc",
    content: "Test content",
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  }
}

export function makeCard(overrides: Partial<AppKanbanCard> = {}): AppKanbanCard {
  return {
    id: "card-1",
    projectId: "proj-1",
    title: "Test Card",
    description: "A test card",
    column: "backlog",
    labels: [],
    linkedDecisionIds: [],
    linkedMessageIds: [],
    position: 0,
    priority: 0,
    contextSnapshot: null,
    lastSessionId: null,
    assignedAgent: null,
    agentStatus: null,
    blockedReason: null,
    startedAt: null,
    completedAt: null,
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  }
}

export function makeDecision(overrides: Partial<AppDecision> = {}): AppDecision {
  return {
    id: "dec-1",
    projectId: "proj-1",
    title: "Test Decision",
    description: "A test decision",
    alternatives: ["Option A", "Option B"],
    reasoning: "Because reasons",
    tradeoffs: "Some tradeoffs",
    createdAt: 1000,
    ...overrides,
  }
}

const notImplemented = (name: string) => (): never => {
  throw new Error(`${name} not implemented in mock`)
}

export function createMockDb(overrides: Partial<AppPersistenceService> = {}): AppPersistenceService {
  return {
    saveMessage: notImplemented("saveMessage"),
    getMessages: notImplemented("getMessages"),
    getActiveConversation: notImplemented("getActiveConversation"),
    createConversation: notImplemented("createConversation"),
    updateConversationSession: notImplemented("updateConversationSession"),
    updateConversationContext: notImplemented("updateConversationContext"),
    archiveConversation: notImplemented("archiveConversation"),
    getRecentConversations: notImplemented("getRecentConversations"),
    incrementMessageCount: notImplemented("incrementMessageCount"),
    getProjects: () => Effect.succeed([]),
    getProject: () => Effect.succeed(null),
    createProject: () => Effect.succeed(makeProject()),
    updateProject: () => Effect.succeed(undefined),
    getProjectDocuments: () => Effect.succeed([]),
    getProjectDocument: () => Effect.succeed(null),
    createProjectDocument: () => Effect.succeed(makeDocument()),
    updateProjectDocument: () => Effect.succeed(undefined),
    getCards: () => Effect.succeed([]),
    getCard: () => Effect.succeed(null),
    createCard: () => Effect.succeed(makeCard()),
    updateCard: () => Effect.succeed(undefined),
    deleteCard: () => Effect.succeed(undefined),
    moveCard: () => Effect.succeed(undefined),
    getNextCard: () => Effect.succeed(null),
    saveCardContext: () => Effect.succeed(undefined),
    assignCardAgent: () => Effect.succeed(undefined),
    updateCardAgentStatus: () => Effect.succeed(undefined),
    startCard: () => Effect.succeed(undefined),
    completeCard: () => Effect.succeed(undefined),
    skipCardToBack: () => Effect.succeed(undefined),
    addCorrection: notImplemented("addCorrection"),
    getCorrections: notImplemented("getCorrections"),
    deactivateCorrection: notImplemented("deactivateCorrection"),
    reactivateCorrection: notImplemented("reactivateCorrection"),
    deleteCorrection: notImplemented("deleteCorrection"),
    logAudit: notImplemented("logAudit"),
    insertTokenUsage: notImplemented("insertTokenUsage"),
    getDecisions: () => Effect.succeed([]),
    getDecision: () => Effect.succeed(null),
    createDecision: () => Effect.succeed(makeDecision()),
    updateDecision: () => Effect.succeed(undefined),
    getUsageSummary: notImplemented("getUsageSummary"),
    ...overrides,
  }
}

export function createMockKanban(overrides: Partial<KanbanService> = {}): KanbanService {
  return {
    getBoard: () => Effect.succeed({ backlog: [], in_progress: [], done: [] }),
    createCard: () => Effect.succeed(makeCard()),
    updateCard: () => Effect.succeed(undefined),
    deleteCard: () => Effect.succeed(undefined),
    moveCard: () => Effect.succeed(undefined),
    createCardFromConversation: notImplemented("createCardFromConversation"),
    getNext: () => Effect.succeed(null),
    skipToBack: () => Effect.succeed(undefined),
    saveContext: () => Effect.succeed(undefined),
    resume: () => Effect.succeed(null),
    assignAgent: () => Effect.succeed(undefined),
    updateAgentStatus: () => Effect.succeed(undefined),
    startWork: () => Effect.succeed(undefined),
    completeWork: () => Effect.succeed(undefined),
    ...overrides,
  }
}

export function createMockThinkingPartner(overrides: Partial<ThinkingPartnerService> = {}): ThinkingPartnerService {
  return {
    logDecision: () => Effect.succeed(makeDecision()),
    getDecisions: () => Effect.succeed([]),
    addAssumption: () => Effect.succeed(makeDocument({ type: "assumptions" })),
    getAssumptions: () => Effect.succeed(null),
    updateStateSummary: () => Effect.succeed(undefined),
    getStateSummary: () => Effect.succeed(null),
    getProjectContext: () => Effect.succeed(""),
    ...overrides,
  }
}
