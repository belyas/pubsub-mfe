import { describe, it, expect, vi } from "vitest";
import { RateLimiter, OriginValidator, MessageSizeValidator, SecurityAuditor } from "./security";

describe("RateLimiter", () => {
  describe("constructor", () => {
    it("should initialize with full token bucket", () => {
      const limiter = new RateLimiter({ maxPerSecond: 100, maxBurst: 200 });
      const stats = limiter.getStats();

      expect(stats.currentTokens).toBe(200);
      expect(stats.maxBurst).toBe(200);
      expect(stats.maxPerSecond).toBe(100);
      expect(stats.messagesBlocked).toBe(0);
    });
  });

  describe("allowMessage", () => {
    it("should allow messages when tokens are available", () => {
      const limiter = new RateLimiter({ maxPerSecond: 100, maxBurst: 10 });

      expect(limiter.allowMessage()).toBe(true);
      expect(limiter.allowMessage()).toBe(true);
      expect(limiter.getStats().currentTokens).toBe(8);
    });

    it("should block messages when bucket is empty", () => {
      const limiter = new RateLimiter({ maxPerSecond: 100, maxBurst: 2 });

      expect(limiter.allowMessage()).toBe(true);
      expect(limiter.allowMessage()).toBe(true);
      expect(limiter.allowMessage()).toBe(false); // Bucket empty
      expect(limiter.getStats().messagesBlocked).toBe(1);
    });

    it("should refill tokens over time", () => {
      vi.useFakeTimers();
      const limiter = new RateLimiter({ maxPerSecond: 10, maxBurst: 10 });

      // Drain bucket
      for (let i = 0; i < 10; i++) {
        expect(limiter.allowMessage()).toBe(true);
      }
      expect(limiter.allowMessage()).toBe(false);

      // Wait 1 second (should refill 10 tokens)
      vi.advanceTimersByTime(1000);
      expect(limiter.allowMessage()).toBe(true);

      vi.useRealTimers();
    });

    it("should not exceed maxBurst when refilling", () => {
      vi.useFakeTimers();
      const limiter = new RateLimiter({ maxPerSecond: 100, maxBurst: 50 });

      // Drain some tokens
      for (let i = 0; i < 30; i++) {
        limiter.allowMessage();
      }

      // Wait 10 seconds (would refill 1000 tokens, but capped at maxBurst)
      vi.advanceTimersByTime(10000);

      const stats = limiter.getStats();
      expect(stats.currentTokens).toBeLessThanOrEqual(stats.maxBurst);

      vi.useRealTimers();
    });

    it("should handle exact boundary at maxBurst requests", () => {
      const limiter = new RateLimiter({ maxPerSecond: 100, maxBurst: 10 });

      // Consume exactly maxBurst tokens
      for (let i = 0; i < 10; i++) {
        expect(limiter.allowMessage()).toBe(true);
      }

      // Next message should be blocked
      expect(limiter.allowMessage()).toBe(false);
      expect(limiter.getStats().messagesBlocked).toBe(1);
    });

    it("should handle time boundary exactly at 1 second refill", () => {
      vi.useFakeTimers();
      const limiter = new RateLimiter({ maxPerSecond: 5, maxBurst: 5 });

      // Drain bucket
      for (let i = 0; i < 5; i++) {
        expect(limiter.allowMessage()).toBe(true);
      }

      // Should be blocked
      expect(limiter.allowMessage()).toBe(false);

      // Advance exactly 1 second
      vi.advanceTimersByTime(1000);

      // Should have exactly 5 tokens available
      expect(limiter.allowMessage()).toBe(true);
      expect(limiter.allowMessage()).toBe(true);
      expect(limiter.allowMessage()).toBe(true);
      expect(limiter.allowMessage()).toBe(true);
      expect(limiter.allowMessage()).toBe(true);

      // Next should be blocked
      expect(limiter.allowMessage()).toBe(false);

      vi.useRealTimers();
    });

    it("should handle float precision in token calculations", () => {
      vi.useFakeTimers();
      const limiter = new RateLimiter({ maxPerSecond: 3, maxBurst: 10 });

      // Drain exactly 3 tokens
      limiter.allowMessage();
      limiter.allowMessage();
      limiter.allowMessage();

      // Drain all remaining tokens (7 more)
      for (let i = 0; i < 7; i++) {
        limiter.allowMessage();
      }

      // Now bucket is empty - next should fail
      expect(limiter.allowMessage()).toBe(false);

      // Wait 335ms (1.005 tokens should refill)
      vi.advanceTimersByTime(335);

      // Should have refilled 1 token
      expect(limiter.allowMessage()).toBe(true);

      // Next should fail again (back to 0 tokens)
      expect(limiter.allowMessage()).toBe(false);

      vi.useRealTimers();
    });

    it("should track blocked messages", () => {
      const limiter = new RateLimiter({ maxPerSecond: 100, maxBurst: 1 });

      limiter.allowMessage(); // Allowed
      limiter.allowMessage(); // Blocked
      limiter.allowMessage(); // Blocked

      expect(limiter.getStats().messagesBlocked).toBe(2);
    });
  });

  describe("reset", () => {
    it("should reset to initial state", () => {
      const limiter = new RateLimiter({ maxPerSecond: 100, maxBurst: 10 });

      // Drain bucket
      for (let i = 0; i < 10; i++) {
        limiter.allowMessage();
      }
      limiter.allowMessage(); // Blocked

      limiter.reset();

      const stats = limiter.getStats();
      expect(stats.currentTokens).toBe(10);
      expect(stats.messagesBlocked).toBe(0);
    });
  });

  describe("getStats", () => {
    it("should return current limiter state", () => {
      const limiter = new RateLimiter({ maxPerSecond: 100, maxBurst: 200 });

      limiter.allowMessage();
      limiter.allowMessage();

      const stats = limiter.getStats();
      expect(stats).toEqual({
        currentTokens: 198,
        maxBurst: 200,
        maxPerSecond: 100,
        messagesBlocked: 0,
      });
    });
  });
});

describe("OriginValidator", () => {
  describe("constructor", () => {
    it("should allow any origin when no whitelist is provided", () => {
      const validator = new OriginValidator({});

      expect(validator.isAllowed("https://example.com")).toBe(true);
      expect(validator.isAllowed("https://evil.com")).toBe(true);
    });

    it("should allow any origin when wildcard is in whitelist", () => {
      const validator = new OriginValidator({ allowedOrigins: ["*"] });

      expect(validator.isAllowed("https://example.com")).toBe(true);
      expect(validator.isAllowed("https://evil.com")).toBe(true);
    });
  });

  describe("isAllowed", () => {
    it("should allow exact origin matches", () => {
      const validator = new OriginValidator({
        allowedOrigins: ["https://example.com", "https://app.example.com"],
      });

      expect(validator.isAllowed("https://example.com")).toBe(true);
      expect(validator.isAllowed("https://app.example.com")).toBe(true);
    });

    it("should block non-whitelisted origins", () => {
      const validator = new OriginValidator({
        allowedOrigins: ["https://example.com"],
      });

      expect(validator.isAllowed("https://evil.com")).toBe(false);
      expect(validator.isAllowed("http://example.com")).toBe(false); // Different protocol
    });

    it("should support wildcard patterns", () => {
      const validator = new OriginValidator({
        allowedOrigins: ["https://*.example.com"],
      });

      expect(validator.isAllowed("https://app.example.com")).toBe(true);
      expect(validator.isAllowed("https://api.example.com")).toBe(true);
      expect(validator.isAllowed("https://sub.app.example.com")).toBe(false); // Too many subdomains
      expect(validator.isAllowed("https://example.com")).toBe(false); // No subdomain
    });

    it("should handle multiple wildcard patterns", () => {
      const validator = new OriginValidator({
        allowedOrigins: ["https://*.example.com", "https://*.test.com"],
      });

      expect(validator.isAllowed("https://app.example.com")).toBe(true);
      expect(validator.isAllowed("https://api.test.com")).toBe(true);
      expect(validator.isAllowed("https://api.dev.test.com")).toBe(false);
      expect(validator.isAllowed("https://app.other.com")).toBe(false);
    });

    it("should handle mixed exact and wildcard patterns", () => {
      const validator = new OriginValidator({
        allowedOrigins: ["https://example.com", "https://*.example.com"],
      });

      expect(validator.isAllowed("https://example.com")).toBe(true);
      expect(validator.isAllowed("https://app.example.com")).toBe(true);
    });

    it("should escape regex special characters in patterns", () => {
      const validator = new OriginValidator({
        allowedOrigins: ["https://example.com/?test=1"],
      });

      expect(validator.isAllowed("https://example.com/?test=1")).toBe(true);
      expect(validator.isAllowed("https://example.com/Xtest=1")).toBe(false);
    });
  });
});

describe("MessageSizeValidator", () => {
  describe("isValid", () => {
    it("should allow messages within size limit", () => {
      const validator = new MessageSizeValidator({ maxBytes: 100 });

      expect(validator.isValid({ data: "small" })).toBe(true);
    });

    it("should block messages exceeding size limit", () => {
      const validator = new MessageSizeValidator({ maxBytes: 50 });

      const largeMessage = { data: "a".repeat(100) };
      expect(validator.isValid(largeMessage)).toBe(false);
    });

    it("should handle nested objects", () => {
      const validator = new MessageSizeValidator({ maxBytes: 1000 });

      const message = {
        user: { id: 1, name: "Alice" },
        items: [1, 2, 3, 4, 5],
        metadata: { timestamp: Date.now() },
      };

      expect(validator.isValid(message)).toBe(true);
    });

    it("should handle arrays", () => {
      const validator = new MessageSizeValidator({ maxBytes: 100 });

      expect(validator.isValid([1, 2, 3, 4, 5])).toBe(true);
      expect(validator.isValid(new Array(1000).fill("x"))).toBe(false);
    });

    it("should handle null and undefined", () => {
      const validator = new MessageSizeValidator({ maxBytes: 100 });

      expect(validator.isValid(null)).toBe(true);
      expect(validator.isValid(undefined)).toBe(true);
    });

    it("should count multi-byte characters correctly", () => {
      const validator = new MessageSizeValidator({ maxBytes: 20 });

      // Emoji are multi-byte
      expect(validator.isValid({ emoji: "😀😀😀😀😀" })).toBe(false);
    });
  });

  describe("getSize", () => {
    it("should return message size in bytes", () => {
      const validator = new MessageSizeValidator({ maxBytes: 1000 });

      const message = { data: "test" };
      const size = validator.getSize(message);

      expect(size).toBeGreaterThan(0);
      expect(typeof size).toBe("number");
    });

    it("should match TextEncoder byte count", () => {
      const validator = new MessageSizeValidator({ maxBytes: 1000 });

      const message = { data: "hello world" };
      const json = JSON.stringify(message);
      const expectedSize = new TextEncoder().encode(json).length;

      expect(validator.getSize(message)).toBe(expectedSize);
    });
  });

  describe("getMaxSize", () => {
    it("should return configured max size", () => {
      const validator = new MessageSizeValidator({ maxBytes: 256 * 1024 });

      expect(validator.getMaxSize()).toBe(256 * 1024);
    });
  });
});

describe("SecurityAuditor", () => {
  describe("logEvent", () => {
    it("should log security events", () => {
      const auditor = new SecurityAuditor({ maxEvents: 100 });

      auditor.logEvent({
        type: "rate_limit",
        timestamp: Date.now(),
      });

      const events = auditor.getRecentEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("rate_limit");
    });

    it("should limit number of stored events", () => {
      const auditor = new SecurityAuditor({ maxEvents: 3 });

      auditor.logEvent({ type: "rate_limit", timestamp: 1 });
      auditor.logEvent({ type: "origin_blocked", timestamp: 2 });
      auditor.logEvent({ type: "size_exceeded", timestamp: 3 });
      auditor.logEvent({ type: "validation_failed", timestamp: 4 });

      const events = auditor.getRecentEvents();
      expect(events).toHaveLength(3);
      expect(events[0].timestamp).toBe(2); // Oldest event should be dropped
    });

    it("should store event details", () => {
      const auditor = new SecurityAuditor({ maxEvents: 100 });

      auditor.logEvent({
        type: "origin_blocked",
        timestamp: Date.now(),
        origin: "https://evil.com",
        details: "Origin not in whitelist",
      });

      const events = auditor.getRecentEvents();
      expect(events[0].origin).toBe("https://evil.com");
      expect(events[0].details).toBe("Origin not in whitelist");
    });
  });

  describe("getRecentEvents", () => {
    it("should return all events when no count specified", () => {
      const auditor = new SecurityAuditor({ maxEvents: 100 });

      auditor.logEvent({ type: "rate_limit", timestamp: 1 });
      auditor.logEvent({ type: "rate_limit", timestamp: 2 });
      auditor.logEvent({ type: "rate_limit", timestamp: 3 });

      expect(auditor.getRecentEvents()).toHaveLength(3);
    });

    it("should return last N events when count specified", () => {
      const auditor = new SecurityAuditor({ maxEvents: 100 });

      for (let i = 0; i < 10; i++) {
        auditor.logEvent({ type: "rate_limit", timestamp: i });
      }

      const recent = auditor.getRecentEvents(3);
      expect(recent).toHaveLength(3);
      expect(recent[0].timestamp).toBe(7);
      expect(recent[2].timestamp).toBe(9);
    });

    it("should not mutate internal events array", () => {
      const auditor = new SecurityAuditor({ maxEvents: 100 });

      auditor.logEvent({ type: "rate_limit", timestamp: 1 });

      const events1 = auditor.getRecentEvents();
      events1.push({ type: "size_exceeded", timestamp: 2 });

      const events2 = auditor.getRecentEvents();
      expect(events2).toHaveLength(1); // Should not include pushed event
    });
  });

  describe("clear", () => {
    it("should remove all events", () => {
      const auditor = new SecurityAuditor({ maxEvents: 100 });

      auditor.logEvent({ type: "rate_limit", timestamp: 1 });
      auditor.logEvent({ type: "rate_limit", timestamp: 2 });

      auditor.clear();

      expect(auditor.getRecentEvents()).toHaveLength(0);
    });
  });

  describe("getStats", () => {
    it("should return event statistics", () => {
      const auditor = new SecurityAuditor({ maxEvents: 100 });

      auditor.logEvent({ type: "rate_limit", timestamp: 1 });
      auditor.logEvent({ type: "rate_limit", timestamp: 2 });
      auditor.logEvent({ type: "origin_blocked", timestamp: 3 });
      auditor.logEvent({ type: "size_exceeded", timestamp: 4 });

      const stats = auditor.getStats();
      expect(stats.totalEvents).toBe(4);
      expect(stats.byType).toEqual({
        rate_limit: 2,
        origin_blocked: 1,
        size_exceeded: 1,
      });
    });

    it("should return empty stats when no events", () => {
      const auditor = new SecurityAuditor({ maxEvents: 100 });

      const stats = auditor.getStats();
      expect(stats.totalEvents).toBe(0);
      expect(stats.byType).toEqual({});
    });
  });
});
