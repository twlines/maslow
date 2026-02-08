/**
 * AppPersistence Legacy Facade
 *
 * Re-exports the AppPersistence tag, layer, and all types from the monolithic
 * AppPersistence module. This facade exists to provide a stable import path
 * during the transition to extracted repositories.
 *
 * @deprecated Import directly from individual repositories once extraction is
 * complete. This facade will be removed after one release cycle.
 */

// Re-export the service tag, layer, and interface
export {
  /** @deprecated Use individual repository services instead */
  AppPersistence,
  /** @deprecated Use individual repository layers instead */
  AppPersistenceLive,
} from "../AppPersistence.js"

export type { AppPersistenceService } from "../AppPersistence.js"

// Re-export all domain types
export type {
  AppMessage,
  AppProject,
  AppProjectDocument,
  AppDecision,
  AppKanbanCard,
  AppConversation,
  UsageSummary,
  SteeringCorrection,
  TokenUsage,
} from "../AppPersistence.js"

// Re-export union/literal types
export type {
  AgentType,
  AgentStatus,
  CorrectionDomain,
  CorrectionSource,
} from "../AppPersistence.js"
