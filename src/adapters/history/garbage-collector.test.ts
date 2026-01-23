import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GarbageCollector, createGarbageCollector } from "./garbage-collector";
import type { HistoryStorage, StoredMessage, ResolvedHistoryConfig } from "./types";

class MockStorage implements HistoryStorage {
  private messages = new Map<string, StoredMessage>();
  public openCalled = false;
  public closeCalled = false;
  private _isOpen = false;

  async open(): Promise<void> {
    this.openCalled = true;
    this._isOpen = true;
  }

  close(): void {
    this.closeCalled = true;
    this._isOpen = false;
  }

  isOpen(): boolean {
    return this._isOpen;
  }

  async put(record: StoredMessage): Promise<boolean> {
    if (this.messages.has(record.id)) {
      return false;
    }
    this.messages.set(record.id, record);
    return true;
  }

  async get(id: string): Promise<StoredMessage | undefined> {
    return this.messages.get(id);
  }

  async query(): Promise<StoredMessage[]> {
    return Array.from(this.messages.values());
  }

  async delete(id: string): Promise<void> {
    this.messages.delete(id);
  }

  async deleteMany(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.messages.delete(id);
    }
  }

  async getExpired(namespace: string, beforeTimestamp: number): Promise<StoredMessage[]> {
    return Array.from(this.messages.values()).filter(
      (m) => m.namespace === namespace && m.timestamp < beforeTimestamp
    );
  }

  async count(namespace: string): Promise<number> {
    return Array.from(this.messages.values()).filter((m) => m.namespace === namespace).length;
  }

  async getOldest(namespace: string, count: number): Promise<StoredMessage[]> {
    return Array.from(this.messages.values())
      .filter((m) => m.namespace === namespace)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, count);
  }

  async clearNamespace(namespace: string): Promise<void> {
    for (const [id, msg] of this.messages) {
      if (msg.namespace === namespace) {
        this.messages.delete(id);
      }
    }
  }

  // Test helpers
  addMessage(id: string, namespace: string, timestamp: number): void {
    this.messages.set(id, {
      id,
      topic: "test",
      timestamp,
      namespace,
      message: { id, topic: "test", ts: timestamp, payload: {} },
      createdAt: timestamp,
    });
  }

  getMessageCount(): number {
    return this.messages.size;
  }
}

describe("GarbageCollector", () => {
  let storage: MockStorage;
  let gc: GarbageCollector;
  let config: ResolvedHistoryConfig;

  beforeEach(() => {
    vi.useFakeTimers();

    storage = new MockStorage();
    config = {
      dbName: "test-db",
      namespace: "test-ns",
      maxMessages: 10,
      ttlSeconds: 60, // 60 seconds
      gcIntervalMs: 1000, // 1 second for testing
      debug: false,
      onError: vi.fn(),
    };
    gc = createGarbageCollector(storage, config);
  });

  afterEach(() => {
    gc.stop();
    vi.useRealTimers();
  });

  describe("Start/Stop", () => {
    it("should start periodic GC", () => {
      gc.start();

      expect(gc.getStats().cyclesCompleted).toBe(0);
    });

    it("should stop periodic GC", () => {
      gc.start();
      gc.stop();

      // Should not throw on double stop
      gc.stop();
    });

    it("should run GC periodically", async () => {
      // Add some messages that will be counted but not removed
      for (let i = 0; i < 5; i++) {
        storage.addMessage(`msg-${i}`, "test-ns", Date.now());
      }

      gc.start();

      await vi.advanceTimersByTimeAsync(config.gcIntervalMs);

      expect(gc.getStats().cyclesCompleted).toBe(1);
    });
  });

  describe("RunFullGc", () => {
    it("should remove TTL-expired messages", async () => {
      const now = Date.now();
      const oldTimestamp = now - 120 * 1000; // 2 minutes ago (expired)
      const recentTimestamp = now - 30 * 1000; // 30 seconds ago (not expired)

      storage.addMessage("old-1", "test-ns", oldTimestamp);
      storage.addMessage("old-2", "test-ns", oldTimestamp);
      storage.addMessage("recent-1", "test-ns", recentTimestamp);

      const result = await gc.runFullGc();

      expect(result.expiredRemoved).toBe(2);
      expect(result.overflowRemoved).toBe(0);
      expect(result.totalRemoved).toBe(2);
      expect(storage.getMessageCount()).toBe(1);
    });

    it("should remove overflow messages (oldest first)", async () => {
      const now = Date.now();

      // Add 15 messages (max is 10)
      for (let i = 0; i < 15; i++) {
        storage.addMessage(`msg-${i}`, "test-ns", now - (15 - i) * 1000);
      }

      const result = await gc.runFullGc();

      expect(result.overflowRemoved).toBe(5);
      expect(storage.getMessageCount()).toBe(10);

      // Verify oldest were removed
      expect(await storage.get("msg-0")).toBeUndefined();
      expect(await storage.get("msg-4")).toBeUndefined();
      expect(await storage.get("msg-5")).toBeDefined();
    });

    it("should handle combined TTL and overflow", async () => {
      const now = Date.now();
      const oldTimestamp = now - 120 * 1000; // expired

      // Add 5 expired + 10 recent = 15 total
      for (let i = 0; i < 5; i++) {
        storage.addMessage(`expired-${i}`, "test-ns", oldTimestamp);
      }
      for (let i = 0; i < 10; i++) {
        storage.addMessage(`recent-${i}`, "test-ns", now - i * 1000);
      }

      const result = await gc.runFullGc();

      expect(result.expiredRemoved).toBe(5);
      expect(result.overflowRemoved).toBe(0); // After TTL removal, only 10 remain
      expect(storage.getMessageCount()).toBe(10);
    });

    it("should not remove anything if under limits", async () => {
      const now = Date.now();

      // Add 5 recent messages (under max of 10, not expired)
      for (let i = 0; i < 5; i++) {
        storage.addMessage(`msg-${i}`, "test-ns", now - i * 1000);
      }

      const result = await gc.runFullGc();

      expect(result.expiredRemoved).toBe(0);
      expect(result.overflowRemoved).toBe(0);
      expect(result.totalRemoved).toBe(0);
      expect(storage.getMessageCount()).toBe(5);
    });

    it("should filter by namespace", async () => {
      const now = Date.now();
      const oldTimestamp = now - 120 * 1000;

      // Add messages to different namespaces
      storage.addMessage("ns1-old", "test-ns", oldTimestamp);
      storage.addMessage("ns2-old", "other-ns", oldTimestamp);

      await gc.runFullGc();

      // Only test-ns message should be removed
      expect(await storage.get("ns1-old")).toBeUndefined();
      expect(await storage.get("ns2-old")).toBeDefined();
    });

    it("should track duration", async () => {
      const result = await gc.runFullGc();

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should not run concurrent GC cycles", async () => {
      // Start a GC that we control
      const slowStorage = new MockStorage();
      let resolveCount: (() => void) | null = null;
      const countPromise = new Promise<number>((resolve) => {
        resolveCount = () => resolve(0);
      });
      slowStorage.count = () => countPromise;

      const slowGc = createGarbageCollector(slowStorage, config);

      // Start first GC (will hang on count)
      const gc1 = slowGc.runFullGc();

      // Try to start second GC immediately
      const gc2 = slowGc.runFullGc();

      // Second should return immediately with 0 removed
      const result2 = await gc2;
      expect(result2.totalRemoved).toBe(0);

      // Resolve the first one
      resolveCount!();
      await gc1;
    });
  });

  describe("CheckOnWrite", () => {
    it("should not trigger GC if under threshold", async () => {
      // Threshold is 90% of maxMessages = 9
      for (let i = 0; i < 5; i++) {
        storage.addMessage(`msg-${i}`, "test-ns", Date.now());
      }

      const triggered = await gc.checkOnWrite();

      expect(triggered).toBe(false);
      expect(gc.getStats().cyclesCompleted).toBe(0);
    });

    it("should trigger GC if at threshold", async () => {
      const now = Date.now();

      // Add 9 messages (at 90% threshold of 10)
      for (let i = 0; i < 9; i++) {
        storage.addMessage(`msg-${i}`, "test-ns", now);
      }

      const triggered = await gc.checkOnWrite();

      expect(triggered).toBe(true);
      expect(gc.getStats().cyclesCompleted).toBe(1);
    });

    it("should trigger GC if over threshold", async () => {
      const now = Date.now();

      // Add 12 messages (over max)
      for (let i = 0; i < 12; i++) {
        storage.addMessage(`msg-${i}`, "test-ns", now);
      }

      const triggered = await gc.checkOnWrite();

      expect(triggered).toBe(true);
      // Should have removed 2 overflow messages
      expect(storage.getMessageCount()).toBe(10);
    });
  });

  describe("GetStats", () => {
    it("should track cumulative stats", async () => {
      const now = Date.now();
      const oldTimestamp = now - 120 * 1000;

      // First cycle: remove expired
      storage.addMessage("exp-1", "test-ns", oldTimestamp);
      storage.addMessage("exp-2", "test-ns", oldTimestamp);
      await gc.runFullGc();

      // Second cycle: remove overflow
      for (let i = 0; i < 15; i++) {
        storage.addMessage(`new-${i}`, "test-ns", now);
      }
      await gc.runFullGc();

      const stats = gc.getStats();

      expect(stats.totalExpiredRemoved).toBe(2);
      expect(stats.totalOverflowRemoved).toBe(5);
      expect(stats.cyclesCompleted).toBe(2);
      expect(stats.lastFullGcTimestamp).toBeGreaterThan(0);
    });

    it("should have null lastFullGcTimestamp initially", () => {
      const stats = gc.getStats();

      expect(stats.lastFullGcTimestamp).toBeNull();
    });
  });

  describe("Error handling", () => {
    it("should call onError callback on failure", async () => {
      const errorStorage = new MockStorage();
      errorStorage.count = () => Promise.reject(new Error("DB error"));

      const errorGc = createGarbageCollector(errorStorage, config);

      await errorGc.checkOnWrite();

      expect(config.onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe("TTL disabled", () => {
    it("should not remove expired if ttlSeconds is 0", async () => {
      const noTtlConfig: ResolvedHistoryConfig = {
        ...config,
        ttlSeconds: 0,
      };
      const noTtlGc = createGarbageCollector(storage, noTtlConfig);

      const oldTimestamp = Date.now() - 999999999;
      storage.addMessage("very-old", "test-ns", oldTimestamp);

      const result = await noTtlGc.runFullGc();

      expect(result.expiredRemoved).toBe(0);
      expect(await storage.get("very-old")).toBeDefined();
    });
  });
});
