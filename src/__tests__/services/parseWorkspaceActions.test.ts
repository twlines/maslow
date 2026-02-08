import { describe, it, expect } from "vitest"
import { parseWorkspaceActions } from "../../services/AppServer.js"

describe("parseWorkspaceActions", () => {
  it("should parse a single create_card action", () => {
    const text = `Here is some text.
:::action
{"type":"create_card","title":"New feature","description":"Build it","column":"backlog"}
:::
More text after.`

    const result = parseWorkspaceActions(text)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      type: "create_card",
      title: "New feature",
      description: "Build it",
      column: "backlog",
    })
  })

  it("should parse multiple action blocks", () => {
    const text = `
:::action
{"type":"create_card","title":"Card A","column":"backlog"}
:::
Some explanation here.
:::action
{"type":"log_decision","title":"Use Effect-TS","reasoning":"Better error handling"}
:::
:::action
{"type":"add_assumption","assumption":"Single user for now"}
:::`

    const result = parseWorkspaceActions(text)
    expect(result).toHaveLength(3)
    expect(result[0].type).toBe("create_card")
    expect(result[1].type).toBe("log_decision")
    expect(result[2].type).toBe("add_assumption")
  })

  it("should parse all valid action types", () => {
    const types = [
      '{"type":"create_card","title":"T"}',
      '{"type":"move_card","title":"T","column":"done"}',
      '{"type":"log_decision","title":"T","description":"D"}',
      '{"type":"add_assumption","assumption":"A"}',
      '{"type":"update_state","summary":"S"}',
    ]
    const text = types.map(t => `:::action\n${t}\n:::`).join("\n")

    const result = parseWorkspaceActions(text)
    expect(result).toHaveLength(5)
    expect(result.map(a => a.type)).toEqual([
      "create_card",
      "move_card",
      "log_decision",
      "add_assumption",
      "update_state",
    ])
  })

  it("should skip malformed JSON", () => {
    const text = `:::action
{not valid json}
:::
:::action
{"type":"create_card","title":"Valid"}
:::`

    const result = parseWorkspaceActions(text)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe("Valid")
  })

  it("should skip blocks with invalid type field", () => {
    const text = `:::action
{"type":"invalid_type","title":"Bad"}
:::
:::action
{"type":"create_card","title":"Good"}
:::`

    const result = parseWorkspaceActions(text)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe("Good")
  })

  it("should skip blocks with missing type field", () => {
    const text = `:::action
{"title":"No type field"}
:::`

    const result = parseWorkspaceActions(text)
    expect(result).toHaveLength(0)
  })

  it("should skip blocks with non-string type field", () => {
    const text = `:::action
{"type":123,"title":"Numeric type"}
:::`

    const result = parseWorkspaceActions(text)
    expect(result).toHaveLength(0)
  })

  it("should return empty array for text with no action blocks", () => {
    const result = parseWorkspaceActions("Just regular text, no actions here.")
    expect(result).toHaveLength(0)
  })

  it("should return empty array for empty string", () => {
    const result = parseWorkspaceActions("")
    expect(result).toHaveLength(0)
  })

  it("should handle action blocks with extra whitespace in JSON", () => {
    const text = `:::action
  { "type" : "create_card" , "title" : "Spaced out" }
:::`

    const result = parseWorkspaceActions(text)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe("Spaced out")
  })

  it("should preserve all optional fields on create_card", () => {
    const text = `:::action
{"type":"create_card","title":"Full card","description":"Desc","column":"in_progress"}
:::`

    const result = parseWorkspaceActions(text)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      type: "create_card",
      title: "Full card",
      description: "Desc",
      column: "in_progress",
    })
  })

  it("should preserve all optional fields on log_decision", () => {
    const text = `:::action
{"type":"log_decision","title":"Choose REST","description":"REST vs GraphQL","alternatives":["REST","GraphQL"],"reasoning":"Simpler","tradeoffs":"Less flexible"}
:::`

    const result = parseWorkspaceActions(text)
    expect(result).toHaveLength(1)
    expect(result[0].alternatives).toEqual(["REST", "GraphQL"])
    expect(result[0].reasoning).toBe("Simpler")
    expect(result[0].tradeoffs).toBe("Less flexible")
  })

  it("should handle multiline JSON inside action block", () => {
    const text = `:::action
{
  "type": "log_decision",
  "title": "Multiline",
  "description": "This spans lines"
}
:::`

    const result = parseWorkspaceActions(text)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe("Multiline")
  })

  it("should not match incomplete delimiters", () => {
    const text = `:::action
{"type":"create_card","title":"Unclosed"}
Some more text without closing delimiter`

    const result = parseWorkspaceActions(text)
    expect(result).toHaveLength(0)
  })

  it("should handle null input gracefully (type coercion edge)", () => {
    const text = `:::action
null
:::`

    const result = parseWorkspaceActions(text)
    expect(result).toHaveLength(0)
  })

  it("should handle array JSON gracefully", () => {
    const text = `:::action
[1, 2, 3]
:::`

    const result = parseWorkspaceActions(text)
    expect(result).toHaveLength(0)
  })
})
