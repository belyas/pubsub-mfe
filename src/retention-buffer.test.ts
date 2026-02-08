import { describe, it, expect } from "vitest";
import { RetentionRingBuffer } from "./retention-buffer";
import type { Message } from "./types";

function createMessage(topic: string, ts: number, payload: unknown = {}): Message {
  return {
    id: `msg-${ts}`,
    topic,
    ts,
    payload,
    meta: {},
  };
}

describe("RetentionRingBuffer", () => {
  describe("construction", () => {
    it("should create buffer with specified capacity", () => {
      const buffer = new RetentionRingBuffer(10);

      expect(buffer.getCapacity()).toBe(10);
      expect(buffer.size).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
    });

    it("should throw error for zero capacity", () => {
      expect(() => new RetentionRingBuffer(0)).toThrow("Capacity must be greater than 0.");
    });

    it("should throw error for negative capacity", () => {
      expect(() => new RetentionRingBuffer(-5)).toThrow("Capacity must be greater than 0.");
    });

    it("should store TTL configuration", () => {
      const buffer = new RetentionRingBuffer(10, 5000);

      expect(buffer.getTtlMs()).toBe(5000);
    });

    it("should return undefined TTL when not configured", () => {
      const buffer = new RetentionRingBuffer(10);

      expect(buffer.getTtlMs()).toBeUndefined();
    });
  });

  describe("push", () => {
    it("should add message to empty buffer", () => {
      const buffer = new RetentionRingBuffer(5);

      buffer.push(createMessage("test", 1000));
      buffer.push(createMessage("test", 2000));

      expect(buffer.size).toBe(2);
      expect(buffer.isEmpty()).toBe(false);
    });

    it("should maintain insertion order", () => {
      const buffer = new RetentionRingBuffer(5);

      buffer.push(createMessage("a", 1000, { n: 1 }));
      buffer.push(createMessage("b", 2000, { n: 2 }));
      buffer.push(createMessage("c", 3000, { n: 3 }));

      const messages = buffer.getMessages(Date.now());

      expect(messages).toHaveLength(3);
      expect(messages[0].payload).toEqual({ n: 1 });
      expect(messages[1].payload).toEqual({ n: 2 });
      expect(messages[2].payload).toEqual({ n: 3 });
    });

    it("should overwrite oldest when reaches capacity", () => {
      const buffer = new RetentionRingBuffer(3);

      buffer.push(createMessage("a", 1000, { n: 1 }));
      buffer.push(createMessage("b", 2000, { n: 2 }));
      buffer.push(createMessage("c", 3000, { n: 3 }));
      buffer.push(createMessage("d", 4000, { n: 4 })); // Should overwrite n: 1

      expect(buffer.size).toBe(3);
      expect(buffer.isFull()).toBe(true);

      const messages = buffer.getMessages(Date.now());

      expect(messages).toHaveLength(3);
      expect(messages[0].payload).toEqual({ n: 2 });
      expect(messages[1].payload).toEqual({ n: 3 });
      expect(messages[2].payload).toEqual({ n: 4 });
    });

    it("should handle multiple wraparounds correctly", () => {
      const buffer = new RetentionRingBuffer(3);

      for (let i = 1; i <= 10; i++) {
        buffer.push(createMessage("test", i * 1000, { n: i }));
      }

      expect(buffer.size).toBe(3);

      const messages = buffer.getMessages(Date.now());

      expect(messages).toHaveLength(3);
      expect(messages[0].payload).toEqual({ n: 8 });
      expect(messages[1].payload).toEqual({ n: 9 });
      expect(messages[2].payload).toEqual({ n: 10 });
    });
  });

  describe("getMessages", () => {
    it("should return empty array for empty buffer", () => {
      const buffer = new RetentionRingBuffer(5);

      expect(buffer.getMessages(Date.now())).toEqual([]);
    });

    it("should return all messages in order", () => {
      const buffer = new RetentionRingBuffer(10);

      buffer.push(createMessage("first", 1000));
      buffer.push(createMessage("second", 2000));
      buffer.push(createMessage("third", 3000));

      const messages = buffer.getMessages(Date.now());

      expect(messages).toHaveLength(3);
      expect(messages[0].topic).toBe("first");
      expect(messages[1].topic).toBe("second");
      expect(messages[2].topic).toBe("third");
    });

    it("should filter by TTL when configured", () => {
      const buffer = new RetentionRingBuffer(10, 100); // 100ms TTL

      buffer.push(createMessage("old", 1000, { old: true }));
      buffer.push(createMessage("fresh", 9999, { fresh: true }));

      // At time 10050, the "old" message (ts: 1000) is expired
      const messages = buffer.getMessages(10050);

      expect(messages).toHaveLength(1);
      expect(messages[0].payload).toEqual({ fresh: true });
    });

    it("should return all messages when no TTL configured", () => {
      const buffer = new RetentionRingBuffer(10); // No TTL

      buffer.push(createMessage("ancient", 1));
      buffer.push(createMessage("recent", 999999));

      const messages = buffer.getMessages(1000000);

      expect(messages).toHaveLength(2);
    });

    it("should preserve order after wraparound", () => {
      const buffer = new RetentionRingBuffer(3);

      buffer.push(createMessage("a", 1000, { n: 1 }));
      buffer.push(createMessage("b", 2000, { n: 2 }));
      buffer.push(createMessage("c", 3000, { n: 3 }));
      buffer.push(createMessage("d", 4000, { n: 4 }));
      buffer.push(createMessage("e", 5000, { n: 5 }));

      const messages = buffer.getMessages(Date.now());

      expect(messages.map((m) => (m.payload as { n: number }).n)).toEqual([3, 4, 5]);
    });

    it("should return only messages at or after sinceTimestamp", () => {
      const buffer = new RetentionRingBuffer(10);

      buffer.push(createMessage("old", 1000, { n: 1 }));
      buffer.push(createMessage("mid", 3000, { n: 2 }));
      buffer.push(createMessage("new", 5000, { n: 3 }));

      const messages = buffer.getMessages(6000, 3000);

      expect(messages).toHaveLength(2);
      expect(messages[0].payload).toEqual({ n: 2 });
      expect(messages[1].payload).toEqual({ n: 3 });
    });

    it("should apply both TTL and sinceTimestamp filters correctly", () => {
      const buffer = new RetentionRingBuffer(10, 5000); // 5s TTL

      buffer.push(createMessage("expired", 1000, { n: 1 })); // expired at now=10000
      buffer.push(createMessage("old-valid", 6000, { n: 2 })); // within TTL, before window
      buffer.push(createMessage("in-window", 8000, { n: 3 })); // within TTL, within window
      buffer.push(createMessage("newest", 9500, { n: 4 })); // within TTL, within window

      // now=10000, TTL=5s → keep msgs with ts >= 5000
      // sinceTimestamp=7000 → keep msgs with ts >= 7000
      const messages = buffer.getMessages(10000, 7000);

      expect(messages).toHaveLength(2);
      expect(messages[0].payload).toEqual({ n: 3 });
      expect(messages[1].payload).toEqual({ n: 4 });
    });

    it("should not double-filter when TTL and window overlap", () => {
      // This is the exact scenario that was bugged before the fix:
      // TTL = 5 min, window = 5 min, both applied from "now"
      const TTL = 5 * 60 * 1000; // 5 minutes
      const WINDOW = 5 * 60 * 1000; // 5 minutes
      const now = 1_000_000;
      const buffer = new RetentionRingBuffer(10, TTL);

      // Message 3 minutes ago — should be within both TTL and window
      buffer.push(createMessage("recent", now - 3 * 60 * 1000, { n: 1 }));
      // Message 4 minutes ago — should be within both TTL and window
      buffer.push(createMessage("older", now - 4 * 60 * 1000, { n: 2 }));

      // Correct usage: pass actual `now` for TTL, and `now - WINDOW` as sinceTimestamp
      const messages = buffer.getMessages(now, now - WINDOW);

      // Both messages should be returned (they are within 5 min TTL and 5 min window)
      expect(messages).toHaveLength(2);
    });

    it("should return all non-expired messages when sinceTimestamp is omitted", () => {
      const buffer = new RetentionRingBuffer(10, 100);

      buffer.push(createMessage("expired", 1000, { n: 1 }));
      buffer.push(createMessage("fresh", 9950, { n: 2 }));

      const messages = buffer.getMessages(10000);

      expect(messages).toHaveLength(1);
      expect(messages[0].payload).toEqual({ n: 2 });
    });

    it("should return empty when sinceTimestamp is in the future", () => {
      const buffer = new RetentionRingBuffer(10);

      buffer.push(createMessage("test", 5000, { n: 1 }));

      const messages = buffer.getMessages(6000, 999999);

      expect(messages).toHaveLength(0);
    });
  });

  describe("clear", () => {
    it("should remove all messages", () => {
      const buffer = new RetentionRingBuffer(5);

      buffer.push(createMessage("a", 1000));
      buffer.push(createMessage("b", 2000));
      buffer.push(createMessage("c", 3000));

      expect(buffer.size).toBe(3);

      buffer.clear();

      expect(buffer.size).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
      expect(buffer.getMessages(Date.now())).toEqual([]);
    });

    it("should allow reuse after clear", () => {
      const buffer = new RetentionRingBuffer(3);

      buffer.push(createMessage("old", 1000));
      buffer.clear();
      buffer.push(createMessage("new", 2000, { reused: true }));

      expect(buffer.size).toBe(1);

      const messages = buffer.getMessages(Date.now());

      expect(messages[0].payload).toEqual({ reused: true });
    });

    it("should reset internal pointers correctly", () => {
      const buffer = new RetentionRingBuffer(3);

      // Fill and wraparound
      for (let i = 0; i < 5; i++) {
        buffer.push(createMessage("test", i * 1000, { n: i }));
      }

      buffer.clear();

      // Refill
      buffer.push(createMessage("a", 10000, { n: "a" }));
      buffer.push(createMessage("b", 11000, { n: "b" }));

      const messages = buffer.getMessages(Date.now());

      expect(messages).toHaveLength(2);
      expect(messages[0].payload).toEqual({ n: "a" });
      expect(messages[1].payload).toEqual({ n: "b" });
    });
  });

  describe("evictExpired", () => {
    it("should return 0 when no TTL configured", () => {
      const buffer = new RetentionRingBuffer(5);

      buffer.push(createMessage("test", 1000));

      const evicted = buffer.evictExpired(Date.now());

      expect(evicted).toBe(0);
      expect(buffer.size).toBe(1);
    });

    it("should evict expired messages from head", () => {
      const buffer = new RetentionRingBuffer(5, 100); // 100ms TTL

      buffer.push(createMessage("expired1", 1000));
      buffer.push(createMessage("expired2", 1050));
      buffer.push(createMessage("fresh", 9950));

      // At time 10000, first two are expired (>100ms old)
      const evicted = buffer.evictExpired(10000);

      expect(evicted).toBe(2);
      expect(buffer.size).toBe(1);

      const messages = buffer.getMessages(10000);

      expect(messages).toHaveLength(1);
      expect(messages[0].topic).toBe("fresh");
    });

    it("should stop at first non-expired message", () => {
      const buffer = new RetentionRingBuffer(5, 100);

      buffer.push(createMessage("expired", 1000));
      buffer.push(createMessage("fresh", 9950)); // Not expired
      buffer.push(createMessage("also-expired-but-after-fresh", 1000));

      // Only first expired message is evicted (contiguous eviction)
      const evicted = buffer.evictExpired(10000);

      expect(evicted).toBe(1);
      expect(buffer.size).toBe(2);
    });

    it("should evict all when all expired", () => {
      const buffer = new RetentionRingBuffer(3, 100);

      buffer.push(createMessage("a", 1000));
      buffer.push(createMessage("b", 1050));
      buffer.push(createMessage("c", 1100));

      const evicted = buffer.evictExpired(10000);

      expect(evicted).toBe(3);
      expect(buffer.size).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
    });

    it("should return 0 when buffer is empty", () => {
      const buffer = new RetentionRingBuffer(5, 100);
      const evicted = buffer.evictExpired(Date.now());

      expect(evicted).toBe(0);
    });

    it("should handle wraparound correctly during eviction", () => {
      const buffer = new RetentionRingBuffer(3, 100);

      // Fill and wraparound
      buffer.push(createMessage("a", 1000, { n: 1 }));
      buffer.push(createMessage("b", 2000, { n: 2 }));
      buffer.push(createMessage("c", 3000, { n: 3 }));
      buffer.push(createMessage("d", 9950, { n: 4 })); // Overwrites 'a'

      // Buffer now has: b(2000), c(3000), d(9950) with head pointing to b
      // At time 10000, b and c are expired
      const evicted = buffer.evictExpired(10000);

      expect(evicted).toBe(2);
      expect(buffer.size).toBe(1);

      const messages = buffer.getMessages(10000);

      expect(messages).toHaveLength(1);
      expect(messages[0].payload).toEqual({ n: 4 });
    });
  });

  describe("peek methods", () => {
    describe("peekOldest", () => {
      it("should return null for empty buffer", () => {
        const buffer = new RetentionRingBuffer(5);

        expect(buffer.peekOldest()).toBeNull();
      });

      it("should return oldest message", () => {
        const buffer = new RetentionRingBuffer(5);

        buffer.push(createMessage("first", 1000, { n: 1 }));
        buffer.push(createMessage("second", 2000, { n: 2 }));

        const oldest = buffer.peekOldest();

        expect(oldest?.payload).toEqual({ n: 1 });
      });

      it("should return correct oldest after wraparound", () => {
        const buffer = new RetentionRingBuffer(3);

        buffer.push(createMessage("a", 1000, { n: 1 }));
        buffer.push(createMessage("b", 2000, { n: 2 }));
        buffer.push(createMessage("c", 3000, { n: 3 }));
        buffer.push(createMessage("d", 4000, { n: 4 })); // Overwrites n: 1

        const oldest = buffer.peekOldest();

        expect(oldest?.payload).toEqual({ n: 2 });
      });

      it("should not remove the message", () => {
        const buffer = new RetentionRingBuffer(5);

        buffer.push(createMessage("test", 1000));

        buffer.peekOldest();
        buffer.peekOldest();

        expect(buffer.size).toBe(1);
      });
    });

    describe("peekNewest", () => {
      it("should return null for empty buffer", () => {
        const buffer = new RetentionRingBuffer(5);

        expect(buffer.peekNewest()).toBeNull();
      });

      it("should return newest message", () => {
        const buffer = new RetentionRingBuffer(5);

        buffer.push(createMessage("first", 1000, { n: 1 }));
        buffer.push(createMessage("second", 2000, { n: 2 }));

        const newest = buffer.peekNewest();

        expect(newest?.payload).toEqual({ n: 2 });
      });

      it("should return correct newest after wraparound", () => {
        const buffer = new RetentionRingBuffer(3);

        buffer.push(createMessage("a", 1000, { n: 1 }));
        buffer.push(createMessage("b", 2000, { n: 2 }));
        buffer.push(createMessage("c", 3000, { n: 3 }));
        buffer.push(createMessage("d", 4000, { n: 4 }));

        const newest = buffer.peekNewest();

        expect(newest?.payload).toEqual({ n: 4 });
      });

      it("should not remove the message", () => {
        const buffer = new RetentionRingBuffer(5);

        buffer.push(createMessage("test", 1000));

        buffer.peekNewest();
        buffer.peekNewest();

        expect(buffer.size).toBe(1);
      });
    });
  });

  describe("state queries", () => {
    it("should return true only when empty", () => {
      const buffer = new RetentionRingBuffer(3);

      expect(buffer.isEmpty()).toBe(true);

      buffer.push(createMessage("test", 1000));
      expect(buffer.isEmpty()).toBe(false);

      buffer.clear();
      expect(buffer.isEmpty()).toBe(true);
    });

    it("should return true only at capacity", () => {
      const buffer = new RetentionRingBuffer(3);

      expect(buffer.isFull()).toBe(false);

      buffer.push(createMessage("a", 1000));
      expect(buffer.isFull()).toBe(false);

      buffer.push(createMessage("b", 2000));
      expect(buffer.isFull()).toBe(false);

      buffer.push(createMessage("c", 3000));
      expect(buffer.isFull()).toBe(true);

      // Adding more keeps it full
      buffer.push(createMessage("d", 4000));
      expect(buffer.isFull()).toBe(true);
    });

    it("should track message count accurately", () => {
      const buffer = new RetentionRingBuffer(3);

      expect(buffer.size).toBe(0);

      buffer.push(createMessage("a", 1000));
      expect(buffer.size).toBe(1);

      buffer.push(createMessage("b", 2000));
      expect(buffer.size).toBe(2);

      buffer.push(createMessage("c", 3000));
      expect(buffer.size).toBe(3);

      // At capacity, size stays the same
      buffer.push(createMessage("d", 4000));
      expect(buffer.size).toBe(3);
    });
  });

  describe("edge cases", () => {
    it("should handle capacity of 1", () => {
      const buffer = new RetentionRingBuffer(1);

      buffer.push(createMessage("first", 1000, { n: 1 }));
      expect(buffer.size).toBe(1);

      buffer.push(createMessage("second", 2000, { n: 2 }));
      expect(buffer.size).toBe(1);

      const messages = buffer.getMessages(Date.now());

      expect(messages).toHaveLength(1);
      expect(messages[0].payload).toEqual({ n: 2 });
    });

    it("should handle very large capacity", () => {
      const buffer = new RetentionRingBuffer(100000);

      for (let i = 0; i < 1000; i++) {
        buffer.push(createMessage("test", i * 1000, { n: i }));
      }

      expect(buffer.size).toBe(1000);
      expect(buffer.isFull()).toBe(false);
    });

    it("should handle TTL of 0 (immediate expiry)", () => {
      const buffer = new RetentionRingBuffer(5, 0);

      buffer.push(createMessage("test", 1000));

      // At same timestamp, message is not expired (0ms difference <= 0ms TTL)
      expect(buffer.getMessages(1000)).toHaveLength(1);

      // At later timestamp, message is expired
      expect(buffer.getMessages(1001)).toHaveLength(0);
    });

    it("should handle messages with same timestamp", () => {
      const buffer = new RetentionRingBuffer(5);

      buffer.push(createMessage("a", 1000, { n: 1 }));
      buffer.push(createMessage("b", 1000, { n: 2 }));
      buffer.push(createMessage("c", 1000, { n: 3 }));

      const messages = buffer.getMessages(Date.now());

      expect(messages).toHaveLength(3);
      expect(messages.map((m) => (m.payload as { n: number }).n)).toEqual([1, 2, 3]);
    });
  });
});
