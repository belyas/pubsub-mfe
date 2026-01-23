import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IndexedDBStorage, createIndexedDBStorage } from "./storage";
import type { StoredMessage } from "./types";
import type { Message } from "../../types";

import "fake-indexeddb/auto";

const TEST_DB_NAME = "test-pubsub-history";
const TEST_NAMESPACE = "test-namespace";

function createTestMessage(id: string, topic: string, timestamp: number): Message {
  return {
    id,
    topic,
    ts: timestamp,
    payload: { data: `test-${id}` },
    meta: { source: "test" },
  };
}

function createStoredMessage(
  id: string,
  topic: string,
  timestamp: number,
  namespace: string = TEST_NAMESPACE
): StoredMessage {
  return {
    id,
    topic,
    timestamp,
    namespace,
    message: createTestMessage(id, topic, timestamp),
    createdAt: timestamp,
  };
}

describe("IndexedDBStorage", () => {
  let storage: IndexedDBStorage;

  beforeEach(async () => {
    // Create a unique DB name for each test to avoid conflicts
    const uniqueDbName = `${TEST_DB_NAME}-${Date.now()}-${Math.random()}`;
    storage = new IndexedDBStorage(uniqueDbName);
    await storage.open();
  });

  afterEach(() => {
    storage.close();
  });

  describe("Open/Close", () => {
    it("should open IndexedDB successfully", async () => {
      const newStorage = createIndexedDBStorage(`${TEST_DB_NAME}-open-test`);

      await expect(newStorage.open()).resolves.toBeUndefined();
      newStorage.close();
    });

    it("should handle multiple open calls gracefully", async () => {
      await expect(storage.open()).resolves.toBeUndefined();
      // Should not throw
    });

    it("should close without error", () => {
      expect(() => storage.close()).not.toThrow();
    });

    it("should throw when operating on closed storage", async () => {
      const newStorage = createIndexedDBStorage(`${TEST_DB_NAME}-closed-test`);
      // Don't open it
      await expect(
        newStorage.put(createStoredMessage("1", "test.topic", Date.now()))
      ).rejects.toThrow("not open");
    });
  });

  describe("Put", () => {
    it("should store a message and return true", async () => {
      const record = createStoredMessage("msg-1", "cart.item.add", Date.now());
      const result = await storage.put(record);

      expect(result).toBe(true);
    });

    it("should return false for duplicate message ID", async () => {
      const record = createStoredMessage("msg-dup", "cart.item.add", Date.now());

      const first = await storage.put(record);
      const second = await storage.put(record);

      expect(first).toBe(true);
      expect(second).toBe(false);
    });

    it("should store messages with different IDs", async () => {
      const record1 = createStoredMessage("msg-a", "cart.item.add", Date.now());
      const record2 = createStoredMessage("msg-b", "cart.item.add", Date.now());

      const result1 = await storage.put(record1);
      const result2 = await storage.put(record2);

      expect(result1).toBe(true);
      expect(result2).toBe(true);
    });
  });

  describe("Get", () => {
    it("should retrieve a stored message by ID", async () => {
      const record = createStoredMessage("msg-get", "cart.item.add", 1000);
      await storage.put(record);

      const retrieved = await storage.get("msg-get");

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe("msg-get");
      expect(retrieved?.topic).toBe("cart.item.add");
      expect(retrieved?.timestamp).toBe(1000);
    });

    it("should return undefined for non-existent ID", async () => {
      const retrieved = await storage.get("non-existent");

      expect(retrieved).toBeUndefined();
    });
  });

  describe("Query", () => {
    beforeEach(async () => {
      await storage.put(createStoredMessage("m1", "cart.item.add", 1000, TEST_NAMESPACE));
      await storage.put(createStoredMessage("m2", "cart.item.remove", 2000, TEST_NAMESPACE));
      await storage.put(createStoredMessage("m3", "user.login", 3000, TEST_NAMESPACE));
      await storage.put(createStoredMessage("m4", "cart.checkout", 4000, TEST_NAMESPACE));
      await storage.put(createStoredMessage("m5", "user.logout", 5000, TEST_NAMESPACE));
      // Message in different namespace
      await storage.put(createStoredMessage("m6", "cart.item.add", 6000, "other-namespace"));
    });

    it("should query exact topic match", async () => {
      const results = await storage.query(TEST_NAMESPACE, "cart.item.add");

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("m1");
    });

    it("should query with single-level wildcard (+)", async () => {
      const results = await storage.query(TEST_NAMESPACE, "cart.+.add");

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("m1");
    });

    it("should query with multi-level wildcard (#)", async () => {
      const results = await storage.query(TEST_NAMESPACE, "cart.#");

      expect(results).toHaveLength(3);

      const ids = results.map((r) => r.id);
      expect(ids).toContain("m1");
      expect(ids).toContain("m2");
      expect(ids).toContain("m4");
    });

    it("should filter by namespace", async () => {
      const results = await storage.query("other-namespace", "cart.#");

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("m6");
    });

    it("should filter by fromTime", async () => {
      const results = await storage.query(TEST_NAMESPACE, "#", { fromTime: 3000 });

      expect(results).toHaveLength(3);

      const ids = results.map((r) => r.id);
      expect(ids).toContain("m3");
      expect(ids).toContain("m4");
      expect(ids).toContain("m5");
    });

    it("should apply limit (returns most recent)", async () => {
      const results = await storage.query(TEST_NAMESPACE, "#", { limit: 2 });

      expect(results).toHaveLength(2);

      // Should return the 2 most recent (m4, m5)
      const ids = results.map((r) => r.id);
      expect(ids).toContain("m4");
      expect(ids).toContain("m5");
    });

    it("should combine fromTime and limit", async () => {
      const results = await storage.query(TEST_NAMESPACE, "#", { fromTime: 2000, limit: 2 });

      expect(results).toHaveLength(2);

      // From 2000+: m2, m3, m4, m5 -> last 2 = m4, m5
      const ids = results.map((r) => r.id);
      expect(ids).toContain("m4");
      expect(ids).toContain("m5");
    });

    it("should return empty array for no matches", async () => {
      const results = await storage.query(TEST_NAMESPACE, "nonexistent.topic");

      expect(results).toHaveLength(0);
    });

    it("should return results sorted by timestamp ascending", async () => {
      const results = await storage.query(TEST_NAMESPACE, "#");

      for (let i = 1; i < results.length; i++) {
        expect(results[i].timestamp).toBeGreaterThanOrEqual(results[i - 1].timestamp);
      }
    });
  });

  describe("Delete", () => {
    it("should delete a message by ID", async () => {
      const record = createStoredMessage("msg-delete", "test.topic", Date.now());

      await storage.put(record);
      await storage.delete("msg-delete");

      const retrieved = await storage.get("msg-delete");
      expect(retrieved).toBeUndefined();
    });

    it("should not throw when deleting non-existent ID", async () => {
      await expect(storage.delete("non-existent")).resolves.toBeUndefined();
    });
  });

  describe("DeleteMany", () => {
    it("should delete multiple messages", async () => {
      await storage.put(createStoredMessage("d1", "test", 1000));
      await storage.put(createStoredMessage("d2", "test", 2000));
      await storage.put(createStoredMessage("d3", "test", 3000));

      await storage.deleteMany(["d1", "d3"]);

      expect(await storage.get("d1")).toBeUndefined();
      expect(await storage.get("d2")).toBeDefined();
      expect(await storage.get("d3")).toBeUndefined();
    });

    it("should handle empty array", async () => {
      await expect(storage.deleteMany([])).resolves.toBeUndefined();
    });
  });

  describe("GetExpired", () => {
    beforeEach(async () => {
      await storage.put(createStoredMessage("e1", "test", 1000, TEST_NAMESPACE));
      await storage.put(createStoredMessage("e2", "test", 2000, TEST_NAMESPACE));
      await storage.put(createStoredMessage("e3", "test", 3000, TEST_NAMESPACE));
      await storage.put(createStoredMessage("e4", "test", 4000, TEST_NAMESPACE));
    });

    it("should return messages older than cutoff", async () => {
      const expired = await storage.getExpired(TEST_NAMESPACE, 3000);

      expect(expired).toHaveLength(2);

      const ids = expired.map((r) => r.id);
      expect(ids).toContain("e1");
      expect(ids).toContain("e2");
    });

    it("should return empty array if no expired messages", async () => {
      const expired = await storage.getExpired(TEST_NAMESPACE, 500);

      expect(expired).toHaveLength(0);
    });

    it("should filter by namespace", async () => {
      await storage.put(createStoredMessage("other", "test", 1500, "other-ns"));

      const expired = await storage.getExpired(TEST_NAMESPACE, 3000);
      const ids = expired.map((r) => r.id);

      expect(ids).not.toContain("other");
    });
  });

  describe("Count", () => {
    it("should return correct count for namespace", async () => {
      await storage.put(createStoredMessage("c1", "test", 1000, TEST_NAMESPACE));
      await storage.put(createStoredMessage("c2", "test", 2000, TEST_NAMESPACE));
      await storage.put(createStoredMessage("c3", "test", 3000, "other-ns"));

      const count = await storage.count(TEST_NAMESPACE);
      expect(count).toBe(2);
    });

    it("should return 0 for empty namespace", async () => {
      const count = await storage.count("empty-namespace");

      expect(count).toBe(0);
    });
  });

  describe("GetOldest", () => {
    beforeEach(async () => {
      await storage.put(createStoredMessage("o1", "test", 1000, TEST_NAMESPACE));
      await storage.put(createStoredMessage("o2", "test", 2000, TEST_NAMESPACE));
      await storage.put(createStoredMessage("o3", "test", 3000, TEST_NAMESPACE));
      await storage.put(createStoredMessage("o4", "test", 4000, TEST_NAMESPACE));
    });

    it("should return N oldest messages", async () => {
      const oldest = await storage.getOldest(TEST_NAMESPACE, 2);

      expect(oldest).toHaveLength(2);
      expect(oldest[0].id).toBe("o1");
      expect(oldest[1].id).toBe("o2");
    });

    it("should return all if count exceeds total", async () => {
      const oldest = await storage.getOldest(TEST_NAMESPACE, 100);

      expect(oldest).toHaveLength(4);
    });

    it("should return empty for count <= 0", async () => {
      expect(await storage.getOldest(TEST_NAMESPACE, 0)).toHaveLength(0);
      expect(await storage.getOldest(TEST_NAMESPACE, -1)).toHaveLength(0);
    });
  });

  describe("ClearNamespace", () => {
    it("should clear all messages in namespace", async () => {
      await storage.put(createStoredMessage("cl1", "test", 1000, TEST_NAMESPACE));
      await storage.put(createStoredMessage("cl2", "test", 2000, TEST_NAMESPACE));
      await storage.put(createStoredMessage("cl3", "test", 3000, "other-ns"));

      await storage.clearNamespace(TEST_NAMESPACE);

      expect(await storage.count(TEST_NAMESPACE)).toBe(0);
      expect(await storage.count("other-ns")).toBe(1);
    });
  });
});
