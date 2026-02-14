import { describe, it, expect } from "vitest"
import { runGate0, type Gate0Options } from "../../services/protocols/Gate0Protocol.js"

const makeOptions = (overrides: Partial<Gate0Options> = {}): Gate0Options => ({
  card: {
    id: "card-123",
    title: "Fix the login bug",
    description: "The login form throws a 500 error on submit",
    contextSnapshot: null,
    agentStatus: null,
  },
  cwd: process.cwd(),
  runningCardIds: new Set(),
  skillCount: 2,
  ...overrides,
})

describe("Gate0Protocol", () => {
  it("should pass when all checks are valid", () => {
    const result = runGate0(makeOptions())
    expect(result.passed).toBe(true)
    expect(result.failures).toHaveLength(0)
  })

  it("should fail when card has no title", () => {
    const result = runGate0(makeOptions({
      card: { id: "c1", title: "", description: "desc", contextSnapshot: null, agentStatus: null },
    }))
    expect(result.passed).toBe(false)
    expect(result.failures).toContain("Card has no title")
  })

  it("should fail when card has whitespace-only title", () => {
    const result = runGate0(makeOptions({
      card: { id: "c1", title: "   ", description: "desc", contextSnapshot: null, agentStatus: null },
    }))
    expect(result.passed).toBe(false)
    expect(result.failures).toContain("Card has no title")
  })

  it("should fail when card has no description and no context", () => {
    const result = runGate0(makeOptions({
      card: { id: "c1", title: "Fix bug", description: "", contextSnapshot: null, agentStatus: null },
    }))
    expect(result.passed).toBe(false)
    expect(result.failures.some(f => f.includes("no description or context"))).toBe(true)
  })

  it("should pass when card has context snapshot but no description", () => {
    const result = runGate0(makeOptions({
      card: { id: "c1", title: "Fix bug", description: "", contextSnapshot: "Previous agent context here", agentStatus: null },
    }))
    expect(result.passed).toBe(true)
  })

  it("should fail when card is already running", () => {
    const result = runGate0(makeOptions({
      runningCardIds: new Set(["card-123"]),
    }))
    expect(result.passed).toBe(false)
    expect(result.failures.some(f => f.includes("already running"))).toBe(true)
  })

  it("should fail when card agent status is running", () => {
    const result = runGate0(makeOptions({
      card: { id: "c1", title: "Fix bug", description: "desc", contextSnapshot: null, agentStatus: "running" },
    }))
    expect(result.passed).toBe(false)
    expect(result.failures.some(f => f.includes("agent-running"))).toBe(true)
  })

  it("should fail when no skills match", () => {
    const result = runGate0(makeOptions({ skillCount: 0 }))
    expect(result.passed).toBe(false)
    expect(result.failures.some(f => f.includes("No skills"))).toBe(true)
  })

  it("should collect multiple failures", () => {
    const result = runGate0(makeOptions({
      card: { id: "card-123", title: "", description: "", contextSnapshot: null, agentStatus: "running" },
      runningCardIds: new Set(["card-123"]),
      skillCount: 0,
    }))
    expect(result.passed).toBe(false)
    // Should have at least: no title, no description, already running (x2), no skills
    expect(result.failures.length).toBeGreaterThanOrEqual(4)
  })

  it("should pass git state check in a valid git repo", () => {
    // We're running tests from the repo root — git status should work
    const result = runGate0(makeOptions())
    expect(result.passed).toBe(true)
    expect(result.failures.some(f => f.includes("git status"))).toBe(false)
  })
})
