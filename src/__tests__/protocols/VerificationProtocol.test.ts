/**
 * VerificationProtocol Tests — Sprint 3b (Card 5: Timeout Surfacing)
 *
 * Tests that runVerification returns timedOut fields and that
 * the VerificationCheckResult interface is complete.
 */

import { describe, it, expect } from "vitest"
import { runVerification, type VerificationCheckResult } from "../../services/protocols/VerificationProtocol.js"

describe("VerificationProtocol", () => {
  describe("VerificationCheckResult shape", () => {
    it("includes timedOut fields", () => {
      // Type-level test: ensure the interface has the new fields
      const result: VerificationCheckResult = {
        passed: false,
        tscOutput: "",
        lintOutput: "",
        testOutput: "",
        tscTimedOut: false,
        lintTimedOut: false,
        testTimedOut: false,
      }

      expect(typeof result.tscTimedOut).toBe("boolean")
      expect(typeof result.lintTimedOut).toBe("boolean")
      expect(typeof result.testTimedOut).toBe("boolean")
    })
  })

  describe("runVerification", () => {
    it("returns timedOut=false for normal failures", () => {
      // Run verification against a non-existent directory — commands will fail
      // but should not be killed/timed out
      const result = runVerification("/tmp/nonexistent-dir-for-test")

      expect(result.passed).toBe(false)
      expect(result.tscTimedOut).toBe(false)
      expect(result.lintTimedOut).toBe(false)
      expect(result.testTimedOut).toBe(false)
    })

    it("includes all required fields in result", () => {
      const result = runVerification("/tmp/nonexistent-dir-for-test")

      expect(typeof result.passed).toBe("boolean")
      expect(typeof result.tscOutput).toBe("string")
      expect(typeof result.lintOutput).toBe("string")
      expect(typeof result.testOutput).toBe("string")
      expect(typeof result.tscTimedOut).toBe("boolean")
      expect(typeof result.lintTimedOut).toBe("boolean")
      expect(typeof result.testTimedOut).toBe("boolean")
    })
  })
})
