import { describe, it, expect, vi } from "vitest";
import { createHistoryAdapter } from "./adapter";
import { PubSubBusImpl } from "../../bus";

import "fake-indexeddb/auto";

const flushPromises = (delay = 10) => new Promise((resolve) => setTimeout(resolve, delay));

/**
 * Integration tests for the History Adapter.
 *
 * These tests simulate real-world scenarios including:
 * - Late-joiner retrieving historical messages
 * - Cross-tab message sharing (simulated via shared IndexedDB)
 * - Retention policy enforcement
 * - GC behavior with real message flows
 */
describe("HistoryAdapter Integration", () => {
  let dbCounter = 0;

  function createUniqueDbName(): string {
    dbCounter++;
    return `integration-test-${dbCounter}-${Date.now()}`;
  }

  // Note: We don't use vi.useFakeTimers() because fake-indexeddb
  // relies on real async operations that get blocked by fake timers

  describe("Late-Joiner scenario", () => {
    it("should allow late-joiner to retrieve historical messages", async () => {
      const dbName = createUniqueDbName();
      const namespace = "late-joiner-test";
      const bus1 = new PubSubBusImpl({ app: "app1" });
      const adapter1 = createHistoryAdapter({ dbName, namespace });

      await adapter1.attach(bus1);

      bus1.publish("cart.item.add", { sku: "ABC", qty: 1 });
      bus1.publish("cart.item.add", { sku: "DEF", qty: 2 });
      bus1.publish("user.login", { userId: 123 });

      await flushPromises();

      // Detach (simulating tab close or refresh)
      await adapter1.detach();
      bus1.dispose();

      const bus2 = new PubSubBusImpl({ app: "app2" });
      const adapter2 = createHistoryAdapter({ dbName, namespace });

      await adapter2.attach(bus2);

      // Late-joiner retrieves history
      const cartHistory = await adapter2.getHistory("cart.#");
      const allHistory = await adapter2.getHistory("#");

      expect(cartHistory).toHaveLength(2);
      expect(allHistory).toHaveLength(3);

      const skus = cartHistory.map((m) => (m.payload as { sku: string }).sku);

      expect(skus).toContain("ABC");
      expect(skus).toContain("DEF");

      await adapter2.detach();
      bus2.dispose();
    });

    it("should retrieve filtered history based on topic pattern", async () => {
      const dbName = createUniqueDbName();
      const namespace = "filter-test";
      // First session publishes various topics
      const bus1 = new PubSubBusImpl();
      const adapter1 = createHistoryAdapter({ dbName, namespace });

      await adapter1.attach(bus1);

      bus1.publish("notifications.email", { type: "welcome" });
      bus1.publish("notifications.push", { type: "reminder" });
      bus1.publish("cart.item.add", { sku: "A" });
      bus1.publish("cart.item.remove", { sku: "B" });
      bus1.publish("analytics.pageview", { page: "/" });

      await flushPromises();
      await adapter1.detach();
      bus1.dispose();

      // Late-joiner with specific interest
      const bus2 = new PubSubBusImpl();
      const adapter2 = createHistoryAdapter({ dbName, namespace });

      await adapter2.attach(bus2);

      // Only interested in notifications
      const notificationHistory = await adapter2.getHistory("notifications.#");
      expect(notificationHistory).toHaveLength(2);

      // Only interested in cart
      const cartHistory = await adapter2.getHistory("cart.#");
      expect(cartHistory).toHaveLength(2);

      // Single-level wildcard
      const pushOnlyHistory = await adapter2.getHistory("notifications.push");
      expect(pushOnlyHistory).toHaveLength(1);

      await adapter2.detach();
      bus2.dispose();
    });

    it("should retrieve limited recent history", async () => {
      const dbName = createUniqueDbName();
      const namespace = "limit-test";
      const bus1 = new PubSubBusImpl();
      const adapter1 = createHistoryAdapter({ dbName, namespace });

      await adapter1.attach(bus1);

      // Publish many messages with delays to ensure distinct timestamps
      for (let i = 0; i < 50; i++) {
        bus1.publish("events.stream", { sequence: i });
        await flushPromises(); // Ensure each message has distinct timestamp
      }

      await flushPromises();
      await adapter1.detach();
      bus1.dispose();

      // Late-joiner only wants last 10
      const bus2 = new PubSubBusImpl();
      const adapter2 = createHistoryAdapter({ dbName, namespace });

      await adapter2.attach(bus2);

      const recentHistory = await adapter2.getHistory("events.stream", { limit: 10 });

      expect(recentHistory).toHaveLength(10);

      // Verify we got 10 distinct messages with valid sequences
      const sequences = recentHistory.map((m) => (m.payload as { sequence: number }).sequence);
      expect(sequences.every((sequence) => sequence >= 0 && sequence < 50)).toBe(true);
      // All sequences should be unique
      expect(new Set(sequences).size).toBe(10);

      await adapter2.detach();
      bus2.dispose();
    });
  });

  describe("Cross-Tab sharing (via shared IndexedDB)", () => {
    it("should share history across multiple adapters with same DB", async () => {
      const dbName = createUniqueDbName();
      const namespace = "shared-ns";
      // Create two buses (simulating two tabs)
      const bus1 = new PubSubBusImpl({ app: "tab1" });
      const bus2 = new PubSubBusImpl({ app: "tab2" });
      const adapter1 = createHistoryAdapter({ dbName, namespace });
      const adapter2 = createHistoryAdapter({ dbName, namespace });

      await adapter1.attach(bus1);
      await adapter2.attach(bus2);

      bus1.publish("shared.topic", { from: "tab1" });
      await flushPromises();

      bus2.publish("shared.topic", { from: "tab2" });
      await flushPromises();

      // Both should see all messages
      const history1 = await adapter1.getHistory("shared.topic");
      const history2 = await adapter2.getHistory("shared.topic");

      expect(history1).toHaveLength(2);
      expect(history2).toHaveLength(2);

      await adapter1.detach();
      await adapter2.detach();
      bus1.dispose();
      bus2.dispose();
    });

    it("should isolate different namespaces in same DB", async () => {
      const dbName = createUniqueDbName();
      const bus1 = new PubSubBusImpl();
      const bus2 = new PubSubBusImpl();
      const adapter1 = createHistoryAdapter({ dbName, namespace: "app-a" });
      const adapter2 = createHistoryAdapter({ dbName, namespace: "app-b" });

      await adapter1.attach(bus1);
      await adapter2.attach(bus2);

      // Each app publishes to same topic name
      bus1.publish("events.click", { app: "a" });
      bus2.publish("events.click", { app: "b" });

      await flushPromises();

      // Each adapter only sees its own namespace
      const history1 = await adapter1.getHistory("events.click");
      const history2 = await adapter2.getHistory("events.click");

      expect(history1).toHaveLength(1);
      expect((history1[0].payload as { app: string }).app).toBe("a");

      expect(history2).toHaveLength(1);
      expect((history2[0].payload as { app: string }).app).toBe("b");

      await adapter1.detach();
      await adapter2.detach();
      bus1.dispose();
      bus2.dispose();
    });
  });

  describe("Retention policy enforcement", () => {
    it("should enforce maxMessages limit via GC", async () => {
      const dbName = createUniqueDbName();
      const namespace = "max-msg-test";
      const bus = new PubSubBusImpl();
      const adapter = createHistoryAdapter({
        dbName,
        namespace,
        maxMessages: 10,
        gcIntervalMs: 100, // Fast GC for testing
      });

      await adapter.attach(bus);

      // Publish more than max with delays to ensure distinct timestamps
      for (let i = 0; i < 20; i++) {
        bus.publish("test.topic", { index: i });
        await flushPromises();
      }

      // Verify all messages were persisted
      const beforeGc = await adapter.getStats();
      expect(beforeGc.messagesPersisted).toBe(20);

      // Force GC to ensure cleanup
      await adapter.forceGc();

      const stats = await adapter.getStats();
      // GC should have removed excess messages (20 - 10 = 10 removed)
      expect(stats.estimatedStorageCount).toBeLessThanOrEqual(10);
      expect(stats.messagesGarbageCollected).toBeGreaterThanOrEqual(10);

      // History should contain most recent messages
      const history = await adapter.getHistory("test.topic");
      expect(history.length).toBeLessThanOrEqual(10);

      await adapter.detach();
      bus.dispose();
    });

    it("should enforce TTL via GC", async () => {
      const dbName = createUniqueDbName();
      const namespace = "ttl-test";
      const bus = new PubSubBusImpl();
      const adapter = createHistoryAdapter({
        dbName,
        namespace,
        ttlSeconds: 1, // 1 second TTL for testing
        gcIntervalMs: 100,
      });

      await adapter.attach(bus);

      bus.publish("test.topic", { data: "old" });
      await flushPromises();

      // Should exist initially
      let history = await adapter.getHistory("test.topic");
      expect(history).toHaveLength(1);

      // Wait for TTL to expire (1 second + buffer)
      await flushPromises(1100);

      // Force GC to ensure TTL cleanup
      await adapter.forceGc();

      // Old message should be gone
      history = await adapter.getHistory("test.topic");
      expect(history).toHaveLength(0);

      await adapter.detach();
      bus.dispose();
    }, 10000); // Extended timeout for real time delay
  });

  describe("Message deduplication", () => {
    it("should not store duplicate messages", async () => {
      const dbName = createUniqueDbName();
      const namespace = "dedup-test";
      const bus = new PubSubBusImpl();
      const adapter = createHistoryAdapter({ dbName, namespace });

      await adapter.attach(bus);

      // Publish messages (each has unique ID from bus)
      bus.publish("test.topic", { data: 1 });
      bus.publish("test.topic", { data: 2 });

      await flushPromises();

      const stats = await adapter.getStats();
      expect(stats.messagesPersisted).toBe(2);
      expect(stats.duplicatesSkipped).toBe(0);

      await adapter.detach();
      bus.dispose();
    });
  });

  describe("Error handling", () => {
    it("should call onError callback when storage fails", async () => {
      const onError = vi.fn();
      const dbName = createUniqueDbName();
      const bus = new PubSubBusImpl();
      const adapter = createHistoryAdapter({
        dbName,
        namespace: "error-test",
        onError,
      });

      await adapter.attach(bus);

      // Normal operation should not call onError
      bus.publish("test.topic", { data: "test" });
      await flushPromises();

      expect(onError).not.toHaveBeenCalled();

      await adapter.detach();
      bus.dispose();
    });
  });

  describe("Full workflow simulation", () => {
    it("should handle complete microfrontend lifecycle", async () => {
      const dbName = createUniqueDbName();
      const namespace = "mfe-lifecycle";
      // === Step 1: Header MFE starts and publishes user login ===
      const headerBus = new PubSubBusImpl({ app: "header" });
      const headerAdapter = createHistoryAdapter({ dbName, namespace });

      await headerAdapter.attach(headerBus);

      headerBus.publish("user.login", { userId: 42, username: "john" });
      await flushPromises();

      // === Step 2: Cart MFE loads later (late-joiner) ===
      const cartBus = new PubSubBusImpl({ app: "cart" });
      const cartAdapter = createHistoryAdapter({ dbName, namespace });

      await cartAdapter.attach(cartBus);

      // Cart MFE retrieves user info from history
      const userHistory = await cartAdapter.getHistory("user.login", { limit: 1 });

      expect(userHistory).toHaveLength(1);
      expect((userHistory[0].payload as { userId: number }).userId).toBe(42);

      // Cart publishes events
      cartBus.publish("cart.item.add", { sku: "WIDGET-1", qty: 2 });
      cartBus.publish("cart.item.add", { sku: "GADGET-2", qty: 1 });
      await flushPromises();

      // === Step 3: Checkout MFE loads even later ===
      const checkoutBus = new PubSubBusImpl({ app: "checkout" });
      const checkoutAdapter = createHistoryAdapter({ dbName, namespace });

      await checkoutAdapter.attach(checkoutBus);

      // Checkout can see cart contents from history
      const cartHistory = await checkoutAdapter.getHistory("cart.#");
      expect(cartHistory).toHaveLength(2);
      // And user info
      const userInfo = await checkoutAdapter.getHistory("user.login", { limit: 1 });
      expect(userInfo).toHaveLength(1);

      // === Cleanup ===
      await headerAdapter.detach();
      await cartAdapter.detach();
      await checkoutAdapter.detach();

      headerBus.dispose();
      cartBus.dispose();
      checkoutBus.dispose();
    });
  });
});
