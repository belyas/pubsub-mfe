import { describe, it, expect, beforeEach, vi } from "vitest";
import { DeduplicationCache, createDeduplicationCache } from "./deduplication";
import type { CrossTabEnvelope } from "./types";

describe("Message Deduplication", () => {
  let cache: DeduplicationCache;

  const createEnvelope = (messageId: string, clientId: string): CrossTabEnvelope => ({
    messageId,
    clientId,
    topic: "test.topic",
    payload: {},
    timestamp: Date.now(),
    version: 1,
    origin: "http://localhost:3000",
  });

  beforeEach(() => {
    cache = new DeduplicationCache();
  });

  describe("DeduplicationCache constructor", () => {
    it("should use default configuration", () => {
      const cache = new DeduplicationCache();
      const stats = cache.getStats();

      expect(stats.maxEntries).toBe(1000);
      expect(stats.maxAgeMs).toBe(60000);
      expect(stats.size).toBe(0);
    });

    it("should accept custom maxEntries", () => {
      const cache = new DeduplicationCache({ maxEntries: 500 });
      const stats = cache.getStats();

      expect(stats.maxEntries).toBe(500);
    });

    it("should accept custom maxAgeMs", () => {
      const cache = new DeduplicationCache({ maxAgeMs: 30000 });
      const stats = cache.getStats();

      expect(stats.maxAgeMs).toBe(30000);
    });

    it("should accept onDuplicate callback", () => {
      const onDuplicate = vi.fn();
      const cache = new DeduplicationCache({ onDuplicate });

      const envelope = createEnvelope("msg-1", "client-1");
      cache.markAsSeen(envelope);

      expect(cache.isDuplicate(envelope)).toBe(true);
      expect(onDuplicate).toHaveBeenCalledWith(envelope);
    });
  });

  describe("IsDuplicate", () => {
    it("should return false for unseen messages", () => {
      const envelope = createEnvelope("msg-1", "client-1");

      expect(cache.isDuplicate(envelope)).toBe(false);
    });

    it("should return true for seen messages", () => {
      const envelope = createEnvelope("msg-1", "client-1");

      cache.markAsSeen(envelope);

      expect(cache.isDuplicate(envelope)).toBe(true);
    });

    it("should distinguish messages by messageId", () => {
      const envelope1 = createEnvelope("msg-1", "client-1");
      const envelope2 = createEnvelope("msg-2", "client-1");

      cache.markAsSeen(envelope1);

      expect(cache.isDuplicate(envelope1)).toBe(true);
      expect(cache.isDuplicate(envelope2)).toBe(false);
    });

    it("should distinguish messages by clientId", () => {
      const envelope1 = createEnvelope("msg-1", "client-1");
      const envelope2 = createEnvelope("msg-1", "client-2");

      cache.markAsSeen(envelope1);

      expect(cache.isDuplicate(envelope1)).toBe(true);
      expect(cache.isDuplicate(envelope2)).toBe(false);
    });

    it("should use composite key (messageId:clientId)", () => {
      const envelope1 = createEnvelope("msg-1", "client-1");
      const envelope2 = createEnvelope("msg-1", "client-2");
      const envelope3 = createEnvelope("msg-2", "client-1");

      cache.markAsSeen(envelope1);
      cache.markAsSeen(envelope2);

      expect(cache.isDuplicate(envelope1)).toBe(true);
      expect(cache.isDuplicate(envelope2)).toBe(true);
      expect(cache.isDuplicate(envelope3)).toBe(false);
    });

    it("should return false for expired messages", () => {
      vi.useFakeTimers();

      const cache = new DeduplicationCache({ maxAgeMs: 5000 });
      const envelope = createEnvelope("msg-1", "client-1");

      cache.markAsSeen(envelope);
      expect(cache.isDuplicate(envelope)).toBe(true);

      vi.advanceTimersByTime(6000);

      expect(cache.isDuplicate(envelope)).toBe(false);

      vi.useRealTimers();
    });

    it("should call onDuplicate callback for duplicates", () => {
      const onDuplicate = vi.fn();
      const cache = new DeduplicationCache({ onDuplicate });
      const envelope = createEnvelope("msg-1", "client-1");

      cache.markAsSeen(envelope);
      cache.isDuplicate(envelope);

      expect(onDuplicate).toHaveBeenCalledOnce();
      expect(onDuplicate).toHaveBeenCalledWith(envelope);
    });

    it("should handle onDuplicate callback errors gracefully", () => {
      const onDuplicate = vi.fn(() => {
        throw new Error("Callback error");
      });
      const cache = new DeduplicationCache({ onDuplicate });
      const envelope = createEnvelope("msg-1", "client-1");

      cache.markAsSeen(envelope);

      expect(() => cache.isDuplicate(envelope)).not.toThrow();
      expect(onDuplicate).toHaveBeenCalled();
    });
  });

  describe("MarkAsSeen", () => {
    it("should add message to cache", () => {
      const envelope = createEnvelope("msg-1", "client-1");
      const stats1 = cache.getStats();

      cache.markAsSeen(envelope);
      const stats2 = cache.getStats();

      expect(stats1.size).toBe(0);
      expect(stats2.size).toBe(1);
    });

    it("should update existing entry", () => {
      const envelope = createEnvelope("msg-1", "client-1");

      cache.markAsSeen(envelope);
      const stats1 = cache.getStats();

      cache.markAsSeen(envelope);
      const stats2 = cache.getStats();

      // Size should remain 1 (not create duplicate)
      expect(stats1.size).toBe(1);
      expect(stats2.size).toBe(1);
    });

    it("should evict oldest entry when maxEntries is exceeded", () => {
      const cache = new DeduplicationCache({ maxEntries: 3 });

      const envelope1 = createEnvelope("msg-1", "client-1");
      const envelope2 = createEnvelope("msg-2", "client-1");
      const envelope3 = createEnvelope("msg-3", "client-1");
      const envelope4 = createEnvelope("msg-4", "client-1");

      cache.markAsSeen(envelope1);
      cache.markAsSeen(envelope2);
      cache.markAsSeen(envelope3);

      expect(cache.getStats().size).toBe(3);
      expect(cache.isDuplicate(envelope1)).toBe(true);

      // Adding 4th entry should evict the oldest (envelope1)
      cache.markAsSeen(envelope4);

      expect(cache.getStats().size).toBe(3);
      expect(cache.isDuplicate(envelope1)).toBe(false); // Evicted
      expect(cache.isDuplicate(envelope2)).toBe(true);
      expect(cache.isDuplicate(envelope3)).toBe(true);
      expect(cache.isDuplicate(envelope4)).toBe(true);
    });

    it("should trigger periodic cleanup", () => {
      vi.useFakeTimers();

      const cache = new DeduplicationCache({ maxAgeMs: 10000 });

      for (let i = 0; i < 10; i++) {
        cache.markAsSeen(createEnvelope(`msg-${i}`, "client-1"));
      }

      expect(cache.getStats().size).toBe(10);

      vi.advanceTimersByTime(11000);

      // Add a new message to trigger cleanup
      cache.markAsSeen(createEnvelope("msg-new", "client-1"));

      // Old messages should be cleaned up
      expect(cache.getStats().size).toBeLessThan(10);

      vi.useRealTimers();
    });
  });

  describe("CheckAndMark", () => {
    it("should return true for unseen messages", () => {
      const envelope = createEnvelope("msg-1", "client-1");

      expect(cache.checkAndMark(envelope)).toBe(true);
    });

    it("should return false for seen messages", () => {
      const envelope = createEnvelope("msg-1", "client-1");

      cache.markAsSeen(envelope);

      expect(cache.checkAndMark(envelope)).toBe(false);
    });

    it("should mark unseen messages as seen", () => {
      const envelope = createEnvelope("msg-1", "client-1");

      expect(cache.isDuplicate(envelope)).toBe(false);

      cache.checkAndMark(envelope);

      expect(cache.isDuplicate(envelope)).toBe(true);
    });

    it("should not modify cache for duplicates", () => {
      const envelope = createEnvelope("msg-1", "client-1");

      cache.markAsSeen(envelope);
      const stats1 = cache.getStats();

      cache.checkAndMark(envelope);
      const stats2 = cache.getStats();

      expect(stats1.size).toBe(stats2.size);
    });

    it("should enable simplified processing flow", () => {
      const envelope1 = createEnvelope("msg-1", "client-1");
      const envelope2 = createEnvelope("msg-2", "client-1");
      const envelope3 = createEnvelope("msg-1", "client-1"); // duplicate

      const processed: string[] = [];

      if (cache.checkAndMark(envelope1)) {
        processed.push(envelope1.messageId);
      }

      if (cache.checkAndMark(envelope2)) {
        processed.push(envelope2.messageId);
      }

      if (cache.checkAndMark(envelope3)) {
        processed.push(envelope3.messageId);
      }

      expect(processed).toEqual(["msg-1", "msg-2"]);
    });
  });

  describe("Clear", () => {
    it("should remove all entries", () => {
      for (let i = 0; i < 10; i++) {
        cache.markAsSeen(createEnvelope(`msg-${i}`, "client-1"));
      }

      expect(cache.getStats().size).toBe(10);

      cache.clear();

      expect(cache.getStats().size).toBe(0);
    });

    it("should allow messages to be added again", () => {
      const envelope = createEnvelope("msg-1", "client-1");

      cache.markAsSeen(envelope);
      expect(cache.isDuplicate(envelope)).toBe(true);

      cache.clear();
      expect(cache.isDuplicate(envelope)).toBe(false);

      cache.markAsSeen(envelope);
      expect(cache.isDuplicate(envelope)).toBe(true);
    });
  });

  describe("GetStats", () => {
    it("should return current size", () => {
      expect(cache.getStats().size).toBe(0);

      cache.markAsSeen(createEnvelope("msg-1", "client-1"));
      expect(cache.getStats().size).toBe(1);

      cache.markAsSeen(createEnvelope("msg-2", "client-1"));
      expect(cache.getStats().size).toBe(2);
    });

    it("should return maxEntries configuration", () => {
      const cache1 = new DeduplicationCache({ maxEntries: 500 });
      const cache2 = new DeduplicationCache({ maxEntries: 2000 });

      expect(cache1.getStats().maxEntries).toBe(500);
      expect(cache2.getStats().maxEntries).toBe(2000);
    });

    it("should return maxAgeMs configuration", () => {
      const cache1 = new DeduplicationCache({ maxAgeMs: 30000 });
      const cache2 = new DeduplicationCache({ maxAgeMs: 120000 });

      expect(cache1.getStats().maxAgeMs).toBe(30000);
      expect(cache2.getStats().maxAgeMs).toBe(120000);
    });

    it("should return oldest entry timestamp", () => {
      vi.useFakeTimers();

      const now = Date.now();
      vi.setSystemTime(now);

      cache.markAsSeen(createEnvelope("msg-1", "client-1"));

      vi.advanceTimersByTime(1000);
      cache.markAsSeen(createEnvelope("msg-2", "client-1"));

      const stats = cache.getStats();
      expect(stats.oldestEntry).toBe(now);

      vi.useRealTimers();
    });

    it("should return null for oldestEntry when cache is empty", () => {
      const stats = cache.getStats();

      expect(stats.oldestEntry).toBeNull();
    });
  });

  describe("CreateDeduplicationCache factory", () => {
    it("should create cache instance", () => {
      const cache = createDeduplicationCache();

      expect(cache).toBeInstanceOf(DeduplicationCache);
    });

    it("should accept configuration", () => {
      const cache = createDeduplicationCache({
        maxEntries: 500,
        maxAgeMs: 30000,
      });

      const stats = cache.getStats();
      expect(stats.maxEntries).toBe(500);
      expect(stats.maxAgeMs).toBe(30000);
    });

    it("should work without configuration", () => {
      const cache = createDeduplicationCache();

      const envelope = createEnvelope("msg-1", "client-1");
      expect(cache.checkAndMark(envelope)).toBe(true);
      expect(cache.checkAndMark(envelope)).toBe(false);
    });
  });

  describe("Integration scenarios", () => {
    it("should handle high message volume", () => {
      const cache = new DeduplicationCache({ maxEntries: 1000 });

      // Add 2000 messages (exceeds maxEntries)
      for (let i = 0; i < 2000; i++) {
        cache.markAsSeen(createEnvelope(`msg-${i}`, "client-1"));
      }

      // Cache should not exceed maxEntries
      expect(cache.getStats().size).toBeLessThanOrEqual(1000);

      // Oldest messages should be evicted
      expect(cache.isDuplicate(createEnvelope("msg-0", "client-1"))).toBe(false);

      // Recent messages should still be present
      expect(cache.isDuplicate(createEnvelope("msg-1999", "client-1"))).toBe(true);
    });

    it("should handle multiple clients", () => {
      const envelope1a = createEnvelope("msg-1", "client-a");
      const envelope1b = createEnvelope("msg-1", "client-b");
      const envelope2a = createEnvelope("msg-2", "client-a");

      cache.markAsSeen(envelope1a);
      cache.markAsSeen(envelope1b);

      // Same messageId, different clientId = different keys
      expect(cache.isDuplicate(envelope1a)).toBe(true);
      expect(cache.isDuplicate(envelope1b)).toBe(true);
      expect(cache.isDuplicate(envelope2a)).toBe(false);

      expect(cache.getStats().size).toBe(2);
    });

    it("should handle time-based expiration correctly", () => {
      vi.useFakeTimers();

      const cache = new DeduplicationCache({ maxAgeMs: 5000 });

      const envelope1 = createEnvelope("msg-1", "client-1");
      const envelope2 = createEnvelope("msg-2", "client-1");

      cache.markAsSeen(envelope1);
      vi.advanceTimersByTime(3000);

      cache.markAsSeen(envelope2);
      vi.advanceTimersByTime(3000);

      // envelope1 should be expired (6s > 5s)
      expect(cache.isDuplicate(envelope1)).toBe(false);

      // envelope2 should still be valid (3s < 5s)
      expect(cache.isDuplicate(envelope2)).toBe(true);

      vi.useRealTimers();
    });

    it("should support real-world deduplication pattern", () => {
      const onDuplicate = vi.fn();
      const cache = new DeduplicationCache({ onDuplicate });
      // Simulate receiving the same message from multiple sources
      const envelope = createEnvelope("msg-broadcast", "tab-publisher");

      if (cache.checkAndMark(envelope)) {
        // Process message
        expect(true).toBe(true);
      }

      if (cache.checkAndMark(envelope)) {
        // Should not reach here
        expect(false).toBe(true);
      }

      if (cache.checkAndMark(envelope)) {
        // Should not reach here
        expect(false).toBe(true);
      }

      // onDuplicate should be called twice (for 2nd and 3rd receipt)
      expect(onDuplicate).toHaveBeenCalledTimes(2);
    });

    it("should handle edge case: maxEntries = 1", () => {
      const cache = new DeduplicationCache({ maxEntries: 1 });

      const envelope1 = createEnvelope("msg-1", "client-1");
      const envelope2 = createEnvelope("msg-2", "client-1");

      cache.markAsSeen(envelope1);
      expect(cache.getStats().size).toBe(1);

      cache.markAsSeen(envelope2);

      expect(cache.getStats().size).toBe(1);
      expect(cache.isDuplicate(envelope1)).toBe(false);
      expect(cache.isDuplicate(envelope2)).toBe(true);
    });

    it("should maintain LRU order correctly", () => {
      const cache = new DeduplicationCache({ maxEntries: 3 });

      const env1 = createEnvelope("msg-1", "client-1");
      const env2 = createEnvelope("msg-2", "client-1");
      const env3 = createEnvelope("msg-3", "client-1");
      const env4 = createEnvelope("msg-4", "client-1");

      cache.markAsSeen(env1);
      cache.markAsSeen(env2);
      cache.markAsSeen(env3);

      // Update env1 (moves to end of LRU)
      cache.markAsSeen(env1);

      // Add env4, should evict env2 (oldest after env1 was updated)
      cache.markAsSeen(env4);

      expect(cache.isDuplicate(env1)).toBe(true); // Still present (was updated)
      expect(cache.isDuplicate(env2)).toBe(false); // Evicted
      expect(cache.isDuplicate(env3)).toBe(true); // Still present
      expect(cache.isDuplicate(env4)).toBe(true); // Just added
    });
  });
});
