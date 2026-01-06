/**
 * Unit Tests for Retry Utilities
 */

import { describe, it, expect } from "vitest";
import { isRetryableError } from "../../lib/retry.js";

describe("isRetryableError", () => {
  describe("network errors", () => {
    it("should return true for network errors", () => {
      const error = new Error("network connection failed");
      expect(isRetryableError(error)).toBe(true);
    });

    it("should return true for timeout errors", () => {
      const error = new Error("Request timeout after 30000ms");
      expect(isRetryableError(error)).toBe(true);
    });

    it("should return true for ECONNRESET errors", () => {
      const error = new Error("ECONNRESET: Connection reset by peer");
      expect(isRetryableError(error)).toBe(true);
    });

    it("should return true for ECONNREFUSED errors", () => {
      const error = new Error("ECONNREFUSED: Connection refused");
      expect(isRetryableError(error)).toBe(true);
    });
  });

  describe("rate limit errors", () => {
    it("should return true for rate limit errors", () => {
      const error = new Error("rate limit exceeded");
      expect(isRetryableError(error)).toBe(true);
    });

    it("should return true for 429 errors", () => {
      const error = new Error("HTTP 429 Too Many Requests");
      expect(isRetryableError(error)).toBe(true);
    });
  });

  describe("5xx server errors", () => {
    it("should return true for 500 Internal Server Error", () => {
      const error = new Error("500 Internal Server Error");
      expect(isRetryableError(error)).toBe(true);
    });

    it("should return true for 502 Bad Gateway", () => {
      const error = new Error("502 Bad Gateway");
      expect(isRetryableError(error)).toBe(true);
    });

    it("should return true for 503 Service Unavailable", () => {
      const error = new Error("503 Service Unavailable");
      expect(isRetryableError(error)).toBe(true);
    });

    it("should return true for 504 Gateway Timeout", () => {
      const error = new Error("504 Gateway Timeout");
      expect(isRetryableError(error)).toBe(true);
    });
  });

  describe("non-retryable errors", () => {
    it("should return false for 400 Bad Request", () => {
      const error = new Error("400 Bad Request");
      expect(isRetryableError(error)).toBe(false);
    });

    it("should return false for 401 Unauthorized", () => {
      const error = new Error("401 Unauthorized");
      expect(isRetryableError(error)).toBe(false);
    });

    it("should return false for 403 Forbidden", () => {
      const error = new Error("403 Forbidden");
      expect(isRetryableError(error)).toBe(false);
    });

    it("should return false for 404 Not Found", () => {
      const error = new Error("404 Not Found");
      expect(isRetryableError(error)).toBe(false);
    });

    it("should return false for validation errors", () => {
      const error = new Error("Validation failed: email is required");
      expect(isRetryableError(error)).toBe(false);
    });

    it("should return false for generic errors", () => {
      const error = new Error("Something went wrong");
      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should return false for non-Error objects", () => {
      expect(isRetryableError("string error")).toBe(false);
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
      expect(isRetryableError(42)).toBe(false);
      expect(isRetryableError({ message: "network error" })).toBe(false);
    });

    it("should be case-insensitive for error messages", () => {
      const error = new Error("NETWORK ERROR");
      expect(isRetryableError(error)).toBe(true);
    });
  });
});
