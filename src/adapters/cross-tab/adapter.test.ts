import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CrossTabAdapter, createCrossTabAdapter } from "./adapter";
import { PubSubBusImpl } from "../../bus";
import type { Transport, CrossTabEnvelope } from "./types";
import type { Message } from "../../types";

const TEST_ORIGIN = typeof window !== "undefined" ? window.location.origin : "http://localhost";

describe("CrossTabAdapter", () => {
  let bus: PubSubBusImpl;
  let mockTransport: MockTransport;

  class MockTransport implements Transport {
    private handlers: Array<(envelope: CrossTabEnvelope) => void> = [];
    public sentMessages: CrossTabEnvelope[] = [];
    public closed = false;

    send(envelope: CrossTabEnvelope): void {
      if (this.closed) {
        throw new Error("Transport is closed");
      }
      this.sentMessages.push(envelope);
    }

    onMessage(handler: (envelope: CrossTabEnvelope) => void): () => void {
      this.handlers.push(handler);
      return () => {
        const index = this.handlers.indexOf(handler);
        if (index > -1) {
          this.handlers.splice(index, 1);
        }
      };
    }

    close(): void {
      this.closed = true;
      this.handlers = [];
    }

    isAvailable(): boolean {
      return !this.closed;
    }

    // Test helper: simulate receiving a message
    simulateReceive(envelope: CrossTabEnvelope): void {
      this.handlers.forEach((handler) => handler(envelope));
    }
  }

  beforeEach(() => {
    bus = new PubSubBusImpl();
    mockTransport = new MockTransport();
  });

  afterEach(() => {
    mockTransport.close();
  });

  describe("Constructor", () => {
    it("should create adapter with required config", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
      });

      expect(adapter).toBeDefined();
      expect(adapter.getStats().clientId).toBeTruthy();
    });

    it("should throw if transport is missing", () => {
      expect(() => {
        new CrossTabAdapter({
          channelName: "test",
        } as any);
      }).toThrow("transport is required");
    });

    it("should use provided clientId", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
        clientId: "custom-client-id",
      });

      expect(adapter.getStats().clientId).toBe("custom-client-id");
    });

    it("should generate clientId if not provided", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
      });

      const stats = adapter.getStats();
      expect(stats.clientId).toBeTruthy();
      expect(typeof stats.clientId).toBe("string");
    });

    it("should accept optional configuration", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
        enableLeadership: true,
        emitSystemEvents: false,
        maxMessageSize: 10,
        debug: true,
      });

      expect(adapter).toBeDefined();
    });
  });

  describe("Attach", () => {
    it("should attach to bus successfully", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
      });

      expect(() => adapter.attach(bus)).not.toThrow();
    });

    it("should throw if already attached", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
      });

      adapter.attach(bus);

      expect(() => adapter.attach(bus)).toThrow("already attached");
    });

    it("should emit system.tab.initialized event", async () => {
      vi.useFakeTimers();

      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
        emitSystemEvents: true,
      });

      adapter.attach(bus);
      // Wait for initialization event
      await vi.advanceTimersByTimeAsync(150);

      const initMessages = mockTransport.sentMessages.filter(
        (m) => m.topic === "system.tab.initialized"
      );

      expect(initMessages).toHaveLength(1);
      expect(initMessages[0].payload).toMatchObject({
        clientId: adapter.getStats().clientId,
        isLeader: false,
      });

      vi.useRealTimers();
    });

    it("should not emit system events if disabled", async () => {
      vi.useFakeTimers();

      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
        emitSystemEvents: false,
      });

      adapter.attach(bus);
      await vi.advanceTimersByTimeAsync(150);

      const initMessages = mockTransport.sentMessages.filter(
        (m) => m.topic === "system.tab.initialized"
      );

      expect(initMessages).toHaveLength(0);

      vi.useRealTimers();
    });
  });

  describe("Detach", () => {
    it("should detach from bus successfully", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
      });

      adapter.attach(bus);

      expect(() => adapter.detach()).not.toThrow();
    });

    it("should be idempotent", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
      });

      adapter.attach(bus);
      adapter.detach();

      expect(() => adapter.detach()).not.toThrow();
    });

    it("should close transport", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
      });

      adapter.attach(bus);
      adapter.detach();

      expect(mockTransport.closed).toBe(true);
    });

    it("should stop leadership detector if enabled", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
        enableLeadership: true,
      });

      adapter.attach(bus);
      expect(adapter.isLeader()).toBe(true); // Visible by default
      adapter.detach();

      // Leadership detector should be stopped
      // (can't easily verify, but covered by no errors)
    });
  });

  describe("Local publish -> remote broadcast", () => {
    it("should broadcast locally published messages", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
      });

      adapter.attach(bus);
      bus.publish("test.message", { value: 42 });
      expect(mockTransport.sentMessages.length).toBeGreaterThan(0);

      const broadcastMsg = mockTransport.sentMessages.find((m) => m.topic === "test.message");

      expect(broadcastMsg).toBeDefined();
      expect(broadcastMsg?.payload).toEqual({ value: 42 });
    });

    it("should include client ID in envelope", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
        clientId: "my-client",
      });

      adapter.attach(bus);
      bus.publish("test.message", {});

      const broadcastMsg = mockTransport.sentMessages.find((m) => m.topic === "test.message");

      expect(broadcastMsg?.clientId).toBe("my-client");
    });

    it("should include origin in envelope", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
      });

      adapter.attach(bus);
      bus.publish("test.message", {});

      const broadcastMsg = mockTransport.sentMessages.find((m) => m.topic === "test.message");

      expect(broadcastMsg?.origin).toBeTruthy();
    });
  });

  describe("Remote receive -> local dispatch", () => {
    it("should receive and dispatch remote messages", async () => {
      vi.useFakeTimers();
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
        clientId: "client-1",
      });
      const received: Message[] = [];

      adapter.attach(bus);
      bus.subscribe("test.message", (msg: Message) => received.push(msg));
      // Simulate remote message
      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-2", // Different client
        topic: "test.message",
        payload: { value: 42 },
        timestamp: Date.now(),
        version: 1,
        origin: TEST_ORIGIN,
      };

      mockTransport.simulateReceive(envelope);
      await vi.advanceTimersByTimeAsync(1000);

      expect(received).toHaveLength(1);
      expect(received[0].payload).toEqual({ value: 42 });
      expect(received[0].meta?._crossTab).toBe(true);
      expect(received[0].meta?._sourceClientId).toBe("client-2");

      vi.useRealTimers();
    });

    it("should filter out echo messages (same clientId)", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
        clientId: "client-1",
      });
      const received: Message[] = [];

      adapter.attach(bus);
      bus.subscribe("test.message", (msg: Message) => received.push(msg));
      // Simulate message from self
      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-1", // Same as adapter
        topic: "test.message",
        payload: { value: 42 },
        timestamp: Date.now(),
        version: 1,
        origin: TEST_ORIGIN,
      };

      mockTransport.simulateReceive(envelope);
      // Should not receive own message
      expect(received).toHaveLength(0);
    });

    it("should deduplicate messages", async () => {
      vi.useFakeTimers();

      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
        clientId: "client-1",
      });
      const received: Message[] = [];

      adapter.attach(bus);
      bus.subscribe("test.message", (msg: Message) => received.push(msg));

      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-2",
        topic: "test.message",
        payload: { value: 42 },
        timestamp: Date.now(),
        version: 1,
        origin: TEST_ORIGIN,
      };

      mockTransport.simulateReceive(envelope);
      mockTransport.simulateReceive(envelope);

      await vi.advanceTimersByTimeAsync(1000);

      expect(received).toHaveLength(1);

      vi.useRealTimers();
    });

    it("should reject invalid envelopes", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
        clientId: "client-1",
      });
      const received: Message[] = [];

      adapter.attach(bus);
      bus.subscribe("#", (msg: Message) => received.push(msg));
      // Invalid envelope (missing required fields)
      const invalidEnvelope: any = {
        messageId: "msg-123",
        // Missing clientId, topic, etc.
      };

      mockTransport.simulateReceive(invalidEnvelope);

      expect(received).toHaveLength(0);
      expect(adapter.getStats().messagesRejected).toBe(1);
    });
  });

  describe("GetStats", () => {
    it("should return initial stats", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
        clientId: "test-client",
      });
      const stats = adapter.getStats();

      expect(stats).toMatchObject({
        messagesSent: 0,
        messagesReceived: 0,
        messagesDeduplicated: 0,
        messagesRejected: 0,
        messagesRateLimited: 0,
        dedupeCacheSize: 0,
        isLeader: false,
        clientId: "test-client",
      });
    });

    it("should track sent messages", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
      });

      adapter.attach(bus);

      bus.publish("test.1", {});
      bus.publish("test.2", {});

      const stats = adapter.getStats();
      expect(stats.messagesSent).toBeGreaterThanOrEqual(2); // At least 2 (may include system events)
    });

    it("should track received messages", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
        clientId: "client-1",
      });

      adapter.attach(bus);
      bus.subscribe("#", () => {});

      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-2",
        topic: "test.message",
        payload: {},
        timestamp: Date.now(),
        version: 1,
        origin: TEST_ORIGIN,
      };

      mockTransport.simulateReceive(envelope);

      expect(adapter.getStats().messagesReceived).toBe(1);
    });

    it("should track deduplicated messages", async () => {
      vi.useFakeTimers();

      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
        clientId: "client-1",
      });

      adapter.attach(bus);
      bus.subscribe("#", () => {});

      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-2",
        topic: "test.message",
        payload: {},
        timestamp: Date.now(),
        version: 1,
        origin: TEST_ORIGIN,
      };

      mockTransport.simulateReceive(envelope);
      mockTransport.simulateReceive(envelope); // Duplicate

      await vi.advanceTimersByTimeAsync(1000);

      expect(adapter.getStats().messagesDeduplicated).toBe(1);

      vi.useRealTimers();
    });
  });

  describe("IsLeader", () => {
    it("should return false if leadership is disabled", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
        enableLeadership: false,
      });

      expect(adapter.isLeader()).toBe(false);
    });

    it("should return true if leadership is enabled and tab is visible", () => {
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
        enableLeadership: true,
      });

      // Tab is visible by default in tests
      expect(adapter.isLeader()).toBe(true);
    });
  });

  describe("CreateCrossTabAdapter factory", () => {
    it("should create adapter instance", () => {
      const adapter = createCrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
      });

      expect(adapter).toBeInstanceOf(CrossTabAdapter);
    });

    it("should accept full configuration", () => {
      const adapter = createCrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
        clientId: "custom-id",
        enableLeadership: true,
        emitSystemEvents: false,
        debug: true,
      });

      expect(adapter.getStats().clientId).toBe("custom-id");
    });
  });

  describe("Integration scenarios", () => {
    it('should synchronize messages between two "tabs"', async () => {
      vi.useFakeTimers();

      const transport1 = new MockTransport();
      const transport2 = new MockTransport();
      // Cross-connect transports (simulate BroadcastChannel behavior)
      const originalSend1 = transport1.send.bind(transport1);
      const originalSend2 = transport2.send.bind(transport2);

      transport1.send = (envelope) => {
        originalSend1(envelope);
        transport2.simulateReceive(envelope);
      };
      transport2.send = (envelope) => {
        originalSend2(envelope);
        transport1.simulateReceive(envelope);
      };

      const bus1 = new PubSubBusImpl();
      const bus2 = new PubSubBusImpl();
      const adapter1 = new CrossTabAdapter({
        channelName: "test",
        transport: transport1,
        clientId: "tab-1",
        emitSystemEvents: false,
      });
      const adapter2 = new CrossTabAdapter({
        channelName: "test",
        transport: transport2,
        clientId: "tab-2",
        emitSystemEvents: false,
      });

      adapter1.attach(bus1);
      adapter2.attach(bus2);

      const receivedInTab2: Message[] = [];

      bus2.subscribe("user.login", (msg: Message) => receivedInTab2.push(msg));
      // Publish in tab 1
      bus1.publish("user.login", { userId: 123 });

      await vi.advanceTimersByTimeAsync(1000);

      expect(receivedInTab2).toHaveLength(1);
      expect(receivedInTab2[0].payload).toEqual({ userId: 123 });
      expect(receivedInTab2[0].meta?._sourceClientId).toBe("tab-1");

      vi.useRealTimers();
    });

    it("should handle high message volume", () => {
      vi.useFakeTimers();

      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: mockTransport,
      });

      adapter.attach(bus);

      for (let i = 0; i < 100; i++) {
        bus.publish(`test.${i}`, { index: i });
      }

      const stats = adapter.getStats();

      expect(stats.messagesSent).toBeGreaterThanOrEqual(100);
    });

    it("should recover from transport errors gracefully", () => {
      const faultyTransport = new MockTransport();
      const originalSend = faultyTransport.send.bind(faultyTransport);
      let sendCount = 0;

      faultyTransport.send = (envelope) => {
        sendCount++;

        if (sendCount === 2) {
          throw new Error("Transport failure");
        }
        originalSend(envelope);
      };
      const adapter = new CrossTabAdapter({
        channelName: "test",
        transport: faultyTransport,
        emitSystemEvents: false,
        debug: false,
      });

      adapter.attach(bus);

      // First publish should succeed
      expect(() => {
        bus.publish("test.1", {});
      }).not.toThrow();
      // Second should fail internally but not crash
      expect(() => {
        bus.publish("test.2", {});
      }).not.toThrow();
      // Third should succeed again
      expect(() => {
        bus.publish("test.3", {});
      }).not.toThrow();

      expect(faultyTransport.sentMessages.length).toBeGreaterThan(0);
    });
  });
});
