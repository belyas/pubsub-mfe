import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createPubSub } from "../../index";
import type { PubSubBus } from "../../types";
import { IframeClient, PROTOCOL_VERSION } from "./client";
import type { IframeMessageEnvelope } from "./types";

/**
 * Integration tests for IframeHost <-> IframeClient communication.
 *
 * These tests verify that the host and client adapters work together correctly
 * by simulating the communication channel between them using paired MessagePorts.
 */
class MockMessagePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  private pairedPort: MockMessagePort | null = null;
  private _closed = false;

  postMessage(data: any): void {
    if (this._closed) {
      throw new Error("Port is closed");
    }

    if (this.pairedPort && !this.pairedPort._closed) {
      // Use setTimeout to simulate async message delivery
      setTimeout(() => {
        if (this.pairedPort?.onmessage) {
          const event = new MessageEvent("message", { data });
          this.pairedPort.onmessage(event);
        }
      }, 0);
    }
  }

  start(): void {
    // No-op for mock
  }

  close(): void {
    this._closed = true;
    this.onmessage = null;
  }

  setPairedPort(port: MockMessagePort): void {
    this.pairedPort = port;
  }

  isClosed(): boolean {
    return this._closed;
  }
}

// Helper to create paired MessagePorts
function createMessageChannelPair(): [MockMessagePort, MockMessagePort] {
  const port1 = new MockMessagePort();
  const port2 = new MockMessagePort();

  port1.setPairedPort(port2);
  port2.setPairedPort(port1);

  return [port1, port2];
}

// Helper to create message envelope with proper version
function createMessageEnvelope(
  messageId: string,
  topic: string,
  payload: unknown,
  options?: {
    schemaVersion?: string;
    source?: string;
    timestamp?: number;
  }
): IframeMessageEnvelope {
  return {
    type: "pubsub:MESSAGE",
    version: PROTOCOL_VERSION,
    payload: {
      messageId,
      topic,
      payload,
      timestamp: options?.timestamp ?? Date.now(),
      ...(options?.schemaVersion && { schemaVersion: options.schemaVersion }),
      ...(options?.source && { source: options.source }),
    },
  };
}

describe("IframeHost <-> IframeClient Integration", () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let bus: PubSubBus;
  let client: IframeClient;
  let hostPort: MockMessagePort;
  let clientPort: MockMessagePort;

  const HOST_ORIGIN = "https://host.example.com";

  beforeEach(() => {
    vi.useFakeTimers();

    bus = createPubSub();
    // Create paired MessagePorts
    [hostPort, clientPort] = createMessageChannelPair();
    client = new IframeClient({
      expectedHostOrigin: HOST_ORIGIN,
      debug: false,
    });

    // Directly inject the connection into client (bypass handshake)
    setupClientConnection();
  });

  afterEach(() => {
    client.disconnect();
    hostPort.close();
    clientPort.close();
    vi.useRealTimers();
  });

  /**
   * Helper to directly wire client to clientPort, bypassing handshake.
   */
  function setupClientConnection(): void {
    // Inject port into client
    (client as any).port = clientPort;
    (client as any).connected = true;
    // Wire up client port to handle messages
    clientPort.onmessage = (event: MessageEvent) => {
      (client as any).handlePortMessage(event);
    };

    // Start port
    clientPort.start();
  }

  describe("Client -> Host Communication", () => {
    it("should send messages from client through port", async () => {
      const sentMessages: any[] = [];
      // Capture messages sent to hostPort
      hostPort.onmessage = (event: MessageEvent) => {
        sentMessages.push(event.data);
      };

      hostPort.start();
      client.publish("test.topic", { value: 42 });

      await vi.advanceTimersByTimeAsync(10);

      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].type).toBe("pubsub:MESSAGE");
      expect(sentMessages[0].payload.topic).toBe("test.topic");
      expect(sentMessages[0].payload.payload).toEqual({ value: 42 });
    });

    it("should include metadata when publishing", async () => {
      const sentMessages: any[] = [];
      hostPort.onmessage = (event: MessageEvent) => {
        sentMessages.push(event.data);
      };

      hostPort.start();
      client.publish(
        "test.topic",
        { value: 99 },
        {
          schemaVersion: "1.0",
        }
      );

      await vi.advanceTimersByTimeAsync(10);

      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].payload.schemaVersion).toBe("1.0");
      // Source is the client ID (auto-generated)
      expect(sentMessages[0].payload.source).toBeDefined();
    });

    it("should generate unique message IDs", async () => {
      const sentMessages: any[] = [];
      hostPort.onmessage = (event: MessageEvent) => {
        sentMessages.push(event.data);
      };

      hostPort.start();
      client.publish("test.topic", { value: 1 });
      client.publish("test.topic", { value: 2 });
      client.publish("test.topic", { value: 3 });

      await vi.advanceTimersByTimeAsync(10);

      expect(sentMessages).toHaveLength(3);
      const ids = sentMessages.map((m) => m.payload.messageId);

      // All IDs should be unique
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });
  });

  describe("Host -> Client Communication", () => {
    it("should receive messages from host through port", async () => {
      const receivedMessages: any[] = [];

      client.subscribe("test.topic", (message) => {
        receivedMessages.push(message);
      });

      // Send message from host via hostPort
      hostPort.postMessage(createMessageEnvelope("test-123", "test.topic", { value: 99 }));

      await vi.advanceTimersByTimeAsync(10);

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].payload).toEqual({ value: 99 });
      expect(receivedMessages[0].topic).toBe("test.topic");
    });

    it("should deliver messages with metadata", async () => {
      const receivedMessages: any[] = [];

      client.subscribe("test.topic", (message) => {
        receivedMessages.push(message);
      });

      hostPort.postMessage(
        createMessageEnvelope(
          "test-1",
          "test.topic",
          { value: 42 },
          {
            schemaVersion: "1.0",
            source: "test-host",
          }
        )
      );

      await vi.advanceTimersByTimeAsync(10);

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].payload).toEqual({ value: 42 });
      expect(receivedMessages[0].schemaVersion).toBe("1.0");
      expect(receivedMessages[0].source).toBe("test-host");
    });

    it("should handle multiple subscribers", async () => {
      const received1: any[] = [];
      const received2: any[] = [];
      const received3: any[] = [];

      client.subscribe("test.topic", (message) => {
        received1.push(message);
      });
      client.subscribe("test.topic", (message) => {
        received2.push(message);
      });
      client.subscribe("test.topic", (message) => {
        received3.push(message);
      });

      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-123",
          topic: "test.topic",
          payload: { value: 123 },
          timestamp: Date.now(),
        },
      });

      await vi.advanceTimersByTimeAsync(10);

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
      expect(received3).toHaveLength(1);
      expect(received1[0].payload).toEqual({ value: 123 });
      expect(received2[0].payload).toEqual({ value: 123 });
      expect(received3[0].payload).toEqual({ value: 123 });
    });
  });

  describe("Wildcard Pattern Matching", () => {
    it("should match single-level wildcards (+)", async () => {
      const receivedMessages: any[] = [];

      client.subscribe("test.+", (message) => {
        receivedMessages.push(message);
      });

      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-1",
          topic: "test.foo",
          payload: { value: 1 },
          timestamp: Date.now(),
        },
      });
      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-2",
          topic: "test.bar",
          payload: { value: 2 },
          timestamp: Date.now(),
        },
      });

      // Send non-matching message
      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-3",
          topic: "other.topic",
          payload: { value: 3 },
          timestamp: Date.now(),
        },
      });

      await vi.advanceTimersByTimeAsync(10);

      expect(receivedMessages).toHaveLength(2);
      expect(receivedMessages[0].payload).toEqual({ value: 1 });
      expect(receivedMessages[1].payload).toEqual({ value: 2 });
    });

    it("should match multi-level wildcards (#)", async () => {
      const receivedMessages: any[] = [];

      client.subscribe("cart.#", (message) => {
        receivedMessages.push(message);
      });

      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-1",
          topic: "cart.add",
          payload: { value: 1 },
          timestamp: Date.now(),
        },
      });

      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-2",
          topic: "cart.item.remove",
          payload: { value: 2 },
          timestamp: Date.now(),
        },
      });

      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-3",
          topic: "cart.checkout.payment.completed",
          payload: { value: 3 },
          timestamp: Date.now(),
        },
      });

      // Send non-matching message
      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-4",
          topic: "user.login",
          payload: { value: 4 },
          timestamp: Date.now(),
        },
      });

      await vi.advanceTimersByTimeAsync(10);

      expect(receivedMessages).toHaveLength(3);
      expect(receivedMessages[0].payload).toEqual({ value: 1 });
      expect(receivedMessages[1].payload).toEqual({ value: 2 });
      expect(receivedMessages[2].payload).toEqual({ value: 3 });
    });

    it("should match exact topics without wildcards", async () => {
      const receivedMessages: any[] = [];

      client.subscribe("exact.topic.name", (message) => {
        receivedMessages.push(message);
      });

      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-1",
          topic: "exact.topic.name",
          payload: { value: 1 },
          timestamp: Date.now(),
        },
      });

      // Send non-matching message
      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-2",
          topic: "exact.topic.other",
          payload: { value: 2 },
          timestamp: Date.now(),
        },
      });

      await vi.advanceTimersByTimeAsync(10);

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].payload).toEqual({ value: 1 });
    });
  });

  describe("Subscription Management", () => {
    it("should allow unsubscribing", async () => {
      const receivedMessages: any[] = [];

      const unsubscribe = client.subscribe("test.topic", (message) => {
        receivedMessages.push(message);
      });

      // Send first message
      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-1",
          topic: "test.topic",
          payload: { value: 1 },
          timestamp: Date.now(),
        },
      });

      await vi.advanceTimersByTimeAsync(10);

      unsubscribe();

      // Send second message (should not be received)
      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-2",
          topic: "test.topic",
          payload: { value: 2 },
          timestamp: Date.now(),
        },
      });

      await vi.advanceTimersByTimeAsync(10);

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].payload).toEqual({ value: 1 });
    });

    it("should handle multiple subscriptions to different topics", async () => {
      const topic1Messages: any[] = [];
      const topic2Messages: any[] = [];
      const topic3Messages: any[] = [];

      client.subscribe("topic.one", (message) => {
        topic1Messages.push(message);
      });

      client.subscribe("topic.two", (message) => {
        topic2Messages.push(message);
      });

      client.subscribe("topic.three", (message) => {
        topic3Messages.push(message);
      });

      // Send messages to each topic
      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-1",
          topic: "topic.one",
          payload: { value: 1 },
          timestamp: Date.now(),
        },
      });

      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-2",
          topic: "topic.two",
          payload: { value: 2 },
          timestamp: Date.now(),
        },
      });

      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-3",
          topic: "topic.three",
          payload: { value: 3 },
          timestamp: Date.now(),
        },
      });

      await vi.advanceTimersByTimeAsync(10);

      expect(topic1Messages).toHaveLength(1);
      expect(topic2Messages).toHaveLength(1);
      expect(topic3Messages).toHaveLength(1);
      expect(topic1Messages[0].payload).toEqual({ value: 1 });
      expect(topic2Messages[0].payload).toEqual({ value: 2 });
      expect(topic3Messages[0].payload).toEqual({ value: 3 });
    });

    it("should handle overlapping wildcard subscriptions", async () => {
      const narrowMessages: any[] = [];
      const wideMessages: any[] = [];

      // Subscribe with narrow wildcard
      client.subscribe("cart.item.+", (message) => {
        narrowMessages.push(message);
      });

      // Subscribe with wide wildcard
      client.subscribe("cart.#", (message) => {
        wideMessages.push(message);
      });

      // Send message that matches both
      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-1",
          topic: "cart.item.add",
          payload: { value: 1 },
          timestamp: Date.now(),
        },
      });

      // Send message that matches only wide
      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-2",
          topic: "cart.checkout",
          payload: { value: 2 },
          timestamp: Date.now(),
        },
      });

      await vi.advanceTimersByTimeAsync(10);

      expect(narrowMessages).toHaveLength(1);
      expect(wideMessages).toHaveLength(2);
      expect(narrowMessages[0].payload).toEqual({ value: 1 });
      expect(wideMessages[0].payload).toEqual({ value: 1 });
      expect(wideMessages[1].payload).toEqual({ value: 2 });
    });
  });

  describe("Message Delivery", () => {
    it("should handle high message volume", async () => {
      const receivedMessages: any[] = [];

      client.subscribe("test.topic", (message) => {
        receivedMessages.push(message);
      });

      // Send many messages
      const messageCount = 100;
      for (let i = 0; i < messageCount; i++) {
        hostPort.postMessage({
          type: "pubsub:MESSAGE",
          version: PROTOCOL_VERSION,
          payload: {
            messageId: `test-${i}`,
            topic: "test.topic",
            payload: { value: i },
            timestamp: Date.now(),
          },
        });
      }

      await vi.advanceTimersByTimeAsync(50);

      expect(receivedMessages).toHaveLength(messageCount);
      for (let i = 0; i < messageCount; i++) {
        expect(receivedMessages[i].payload).toEqual({ value: i });
      }
    });

    it("should handle null/undefined payloads", async () => {
      const receivedMessages: any[] = [];

      client.subscribe("test.topic", (message) => {
        receivedMessages.push(message);
      });

      // Send null payload
      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-1",
          topic: "test.topic",
          payload: null,
          timestamp: Date.now(),
        },
      });

      // Send undefined payload
      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-2",
          topic: "test.topic",
          payload: undefined,
          timestamp: Date.now(),
        },
      });

      await vi.advanceTimersByTimeAsync(10);

      expect(receivedMessages).toHaveLength(2);
      expect(receivedMessages[0].payload).toBeNull();
      expect(receivedMessages[1].payload).toBeUndefined();
    });

    it("should handle complex nested data structures", async () => {
      const receivedMessages: any[] = [];

      client.subscribe("test.topic", (message) => {
        receivedMessages.push(message);
      });

      const complexData = {
        nested: {
          deeply: {
            value: 42,
            array: [1, 2, 3, { inner: "test" }],
            map: { key1: "value1", key2: "value2" },
          },
        },
        nullField: null,
        boolField: true,
        numberField: 3.14159,
      };

      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-1",
          topic: "test.topic",
          payload: complexData,
          timestamp: Date.now(),
        },
      });

      await vi.advanceTimersByTimeAsync(10);

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].payload).toMatchObject(complexData);
    });
  });

  describe("Disconnect Handling", () => {
    it("should stop receiving messages after disconnect", async () => {
      const receivedMessages: any[] = [];

      client.subscribe("test.topic", (message) => {
        receivedMessages.push(message);
      });

      // Send first message
      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-1",
          topic: "test.topic",
          payload: { value: 1 },
          timestamp: Date.now(),
        },
      });

      await vi.advanceTimersByTimeAsync(10);
      client.disconnect();
      await vi.advanceTimersByTimeAsync(10);

      // Send second message (should not be received)
      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-2",
          topic: "test.topic",
          payload: { value: 2 },
          timestamp: Date.now(),
        },
      });

      await vi.advanceTimersByTimeAsync(10);

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].payload).toEqual({ value: 1 });
    });

    it("should not publish when disconnected", () => {
      const sentMessages: any[] = [];

      hostPort.onmessage = (event: MessageEvent) => {
        sentMessages.push(event.data);
      };
      hostPort.start();

      client.disconnect();

      // Publish should be ignored
      client.publish("test.topic", { value: 123 });

      expect(sentMessages).toHaveLength(0);
    });

    it("should close the MessagePort on disconnect", () => {
      expect(clientPort.isClosed()).toBe(false);

      client.disconnect();

      expect(clientPort.isClosed()).toBe(true);
    });

    it("should send DISCONNECT envelope when disconnecting", async () => {
      const sentMessages: any[] = [];

      hostPort.onmessage = (event: MessageEvent) => {
        sentMessages.push(event.data);
      };
      hostPort.start();

      client.disconnect();

      await vi.advanceTimersByTimeAsync(10);

      const disconnectMsg = sentMessages.find((m) => m.type === "pubsub:DISCONNECT");
      expect(disconnectMsg).toBeDefined();
      expect(disconnectMsg.type).toBe("pubsub:DISCONNECT");
    });
  });

  describe("Statistics", () => {
    it("should track connection state", () => {
      const stats = client.getStats();

      expect(stats.connected).toBe(true);
    });

    it("should track messages published", async () => {
      hostPort.start();

      const initialStats = client.getStats();
      expect(initialStats.messagesPublished).toBe(0);

      client.publish("test.topic", { value: 1 });
      client.publish("test.topic", { value: 2 });
      client.publish("test.topic", { value: 3 });

      await vi.advanceTimersByTimeAsync(10);

      const finalStats = client.getStats();
      expect(finalStats.messagesPublished).toBe(3);
    });

    it("should track messages received", async () => {
      client.subscribe("test.topic", () => {});

      const initialStats = client.getStats();
      expect(initialStats.messagesReceived).toBe(0);

      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-1",
          topic: "test.topic",
          payload: { value: 1 },
          timestamp: Date.now(),
        },
      });

      hostPort.postMessage({
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "test-2",
          topic: "test.topic",
          payload: { value: 2 },
          timestamp: Date.now(),
        },
      });

      await vi.advanceTimersByTimeAsync(10);

      const finalStats = client.getStats();
      expect(finalStats.messagesReceived).toBe(2);
    });
  });
});
