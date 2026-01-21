import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IframeClient, PROTOCOL_VERSION } from "./client";
import type {
  IframeClientConfig,
  IframeSynEnvelope,
  IframeAckConfirmEnvelope,
  IframeMessageEnvelope,
  IframeDisconnectEnvelope,
} from "./types";

/**
 * Mock MessagePort for testing.
 */
class MockMessagePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  closed = false;

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(_data: unknown): void {
    if (this.closed) {
      throw new Error("Port closed");
    }
    // Messages are handled by the paired port in tests
  }

  start(): void {
    // No-op in mock
  }

  close(): void {
    this.closed = true;
  }

  // Test helper: simulate receiving a message
  simulateMessage(data: unknown): void {
    const event = new MessageEvent("message", { data });
    const listeners = this.listeners.get("message");

    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }
  }
}

/**
 * Mock window for testing.
 */
class MockWindow {
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  // Test helper: simulate receiving a message
  simulateMessage(data: unknown, origin: string, ports: MessagePort[] = []): void {
    const event = new MessageEvent("message", {
      data,
      origin,
      ports,
      source: {
        postMessage: vi.fn(),
      } as unknown as Window,
    });
    const listeners = this.listeners.get("message");

    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }
  }
}

describe("IframeClient", () => {
  let mockWindow: MockWindow;
  let originalWindow: typeof globalThis.window;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWindow = new MockWindow();
    originalWindow = globalThis.window;
    // @ts-expect-error - Mocking window
    globalThis.window = mockWindow as unknown as Window;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    globalThis.window = originalWindow;
  });

  describe("Constructor", () => {
    it("should initialize with required config", () => {
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
      };

      const client = new IframeClient(config);
      expect(client).toBeDefined();

      const stats = client.getStats();
      expect(stats.connected).toBe(false);
      expect(stats.messagesPublished).toBe(0);
      expect(stats.messagesReceived).toBe(0);
    });

    it("should apply default config values", () => {
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
        debug: true,
      };

      const client = new IframeClient(config);
      expect(client).toBeDefined();
    });

    it("should accept optional callbacks", () => {
      const onConnected = vi.fn();
      const onDisconnected = vi.fn();

      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
        onConnected,
        onDisconnected,
      };

      const client = new IframeClient(config);
      expect(client).toBeDefined();
    });
  });

  describe("Connect", () => {
    it("should wait for handshake completion", async () => {
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Simulate SYN from host
      const synEnvelope: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(synEnvelope, "https://host.example.com");

      // Simulate ACK_CONFIRM with port
      const mockPort = new MockMessagePort();
      const ackConfirmEnvelope: IframeAckConfirmEnvelope = {
        type: "pubsub:ACK_CONFIRM",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(ackConfirmEnvelope, "https://host.example.com", [
        mockPort as unknown as MessagePort,
      ]);

      await connectPromise;

      const stats = client.getStats();
      expect(stats.connected).toBe(true);
      expect(stats.connectionAttempts).toBe(1);
    });

    it("should timeout if no handshake", async () => {
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
        handshakeTimeout: 1000,
        autoReconnect: false,
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Advance time past timeout
      vi.advanceTimersByTime(1000);

      await expect(connectPromise).rejects.toThrow("Handshake timeout");
    });

    it("should not connect twice", async () => {
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Complete handshake
      const synEnvelope: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(synEnvelope, "https://host.example.com");

      const mockPort = new MockMessagePort();
      const ackConfirmEnvelope: IframeAckConfirmEnvelope = {
        type: "pubsub:ACK_CONFIRM",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(ackConfirmEnvelope, "https://host.example.com", [
        mockPort as unknown as MessagePort,
      ]);

      await connectPromise;

      // Try connecting again
      await client.connect();
      expect(client.getStats().connectionAttempts).toBe(1);
    });

    it("should reject messages from wrong origin", async () => {
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
        handshakeTimeout: 1000,
        autoReconnect: false,
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Simulate SYN from wrong origin
      const synEnvelope: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(synEnvelope, "https://evil.com");

      // Should timeout since SYN was rejected
      vi.advanceTimersByTime(1000);
      await expect(connectPromise).rejects.toThrow("Handshake timeout");
    });

    it("should call onConnected callback", async () => {
      const onConnected = vi.fn();
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
        onConnected,
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Complete handshake
      const synEnvelope: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(synEnvelope, "https://host.example.com");

      const mockPort = new MockMessagePort();
      const ackConfirmEnvelope: IframeAckConfirmEnvelope = {
        type: "pubsub:ACK_CONFIRM",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(ackConfirmEnvelope, "https://host.example.com", [
        mockPort as unknown as MessagePort,
      ]);

      await connectPromise;

      expect(onConnected).toHaveBeenCalledTimes(1);
      expect(onConnected).toHaveBeenCalledWith(expect.any(String));
    });
  });

  describe("Publish", () => {
    it("should publish message when connected", async () => {
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Complete handshake
      const mockPort = new MockMessagePort();
      const postMessageSpy = vi.spyOn(mockPort, "postMessage");

      const synEnvelope: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(synEnvelope, "https://host.example.com");

      const ackConfirmEnvelope: IframeAckConfirmEnvelope = {
        type: "pubsub:ACK_CONFIRM",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(ackConfirmEnvelope, "https://host.example.com", [
        mockPort as unknown as MessagePort,
      ]);

      await connectPromise;

      // Publish message
      client.publish("test.topic", { data: "hello" });

      expect(postMessageSpy).toHaveBeenCalledTimes(1);
      const envelope = postMessageSpy.mock.calls[0][0] as IframeMessageEnvelope;
      expect(envelope.type).toBe("pubsub:MESSAGE");
      expect(envelope.payload.topic).toBe("test.topic");
      expect(envelope.payload.payload).toEqual({ data: "hello" });

      const stats = client.getStats();
      expect(stats.messagesPublished).toBe(1);
    });

    it("should not publish when disconnected", () => {
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
      };

      const client = new IframeClient(config);

      // Try publishing without connecting
      client.publish("test.topic", { data: "hello" });

      const stats = client.getStats();
      expect(stats.messagesPublished).toBe(0);
    });

    it("should include schemaVersion if provided", async () => {
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Complete handshake
      const mockPort = new MockMessagePort();
      const postMessageSpy = vi.spyOn(mockPort, "postMessage");

      const synEnvelope: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(synEnvelope, "https://host.example.com");

      const ackConfirmEnvelope: IframeAckConfirmEnvelope = {
        type: "pubsub:ACK_CONFIRM",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(ackConfirmEnvelope, "https://host.example.com", [
        mockPort as unknown as MessagePort,
      ]);

      await connectPromise;

      // Publish with schema version
      client.publish("test.topic", { data: "hello" }, { schemaVersion: "test.event@1" });

      const envelope = postMessageSpy.mock.calls[0][0] as IframeMessageEnvelope;
      expect(envelope.payload.schemaVersion).toBe("test.event@1");
    });

    it("should detect disconnect on send failure", async () => {
      const onDisconnected = vi.fn();
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
        onDisconnected,
        autoReconnect: false,
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Complete handshake
      const mockPort = new MockMessagePort();
      const synEnvelope: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(synEnvelope, "https://host.example.com");

      const ackConfirmEnvelope: IframeAckConfirmEnvelope = {
        type: "pubsub:ACK_CONFIRM",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(ackConfirmEnvelope, "https://host.example.com", [
        mockPort as unknown as MessagePort,
      ]);

      await connectPromise;

      // Close port to simulate failure
      mockPort.closed = true;

      // Try publishing
      client.publish("test.topic", { data: "hello" });

      expect(onDisconnected).toHaveBeenCalledWith("send_failed");
      expect(client.getStats().connected).toBe(false);
      expect(client.getStats().disconnections).toBe(1);
    });
  });

  describe("Subscribe", () => {
    it("should receive messages from host", async () => {
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Complete handshake
      const mockPort = new MockMessagePort();
      const synEnvelope: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(synEnvelope, "https://host.example.com");

      const ackConfirmEnvelope: IframeAckConfirmEnvelope = {
        type: "pubsub:ACK_CONFIRM",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(ackConfirmEnvelope, "https://host.example.com", [
        mockPort as unknown as MessagePort,
      ]);

      await connectPromise;

      // Subscribe to topic
      const handler = vi.fn();
      client.subscribe("test.topic", handler);

      // Simulate message from host
      const messageEnvelope: IframeMessageEnvelope = {
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "msg-1",
          topic: "test.topic",
          payload: { data: "hello" },
          timestamp: Date.now(),
        },
      };
      mockPort.simulateMessage(messageEnvelope);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        messageId: "msg-1",
        topic: "test.topic",
        payload: { data: "hello" },
        timestamp: expect.any(Number),
        schemaVersion: undefined,
        source: undefined,
      });

      const stats = client.getStats();
      expect(stats.messagesReceived).toBe(1);
    });

    it("should support wildcard subscriptions", async () => {
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Complete handshake
      const mockPort = new MockMessagePort();
      const synEnvelope: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(synEnvelope, "https://host.example.com");

      const ackConfirmEnvelope: IframeAckConfirmEnvelope = {
        type: "pubsub:ACK_CONFIRM",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(ackConfirmEnvelope, "https://host.example.com", [
        mockPort as unknown as MessagePort,
      ]);

      await connectPromise;

      // Subscribe with wildcard
      const handler = vi.fn();
      client.subscribe("cart.#", handler);

      // Send matching messages
      const msg1: IframeMessageEnvelope = {
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "msg-1",
          topic: "cart.add",
          payload: { itemId: 1 },
          timestamp: Date.now(),
        },
      };
      mockPort.simulateMessage(msg1);

      const msg2: IframeMessageEnvelope = {
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "msg-2",
          topic: "cart.remove",
          payload: { itemId: 2 },
          timestamp: Date.now(),
        },
      };
      mockPort.simulateMessage(msg2);

      // Send non-matching message
      const msg3: IframeMessageEnvelope = {
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "msg-3",
          topic: "user.login",
          payload: { userId: 1 },
          timestamp: Date.now(),
        },
      };
      mockPort.simulateMessage(msg3);

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("should support unsubscribe", async () => {
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Complete handshake
      const mockPort = new MockMessagePort();
      const synEnvelope: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(synEnvelope, "https://host.example.com");

      const ackConfirmEnvelope: IframeAckConfirmEnvelope = {
        type: "pubsub:ACK_CONFIRM",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(ackConfirmEnvelope, "https://host.example.com", [
        mockPort as unknown as MessagePort,
      ]);

      await connectPromise;

      // Subscribe
      const handler = vi.fn();
      const unsubscribe = client.subscribe("test.topic", handler);

      // Send message
      const msg1: IframeMessageEnvelope = {
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "msg-1",
          topic: "test.topic",
          payload: { data: "hello" },
          timestamp: Date.now(),
        },
      };
      mockPort.simulateMessage(msg1);

      expect(handler).toHaveBeenCalledTimes(1);

      // Unsubscribe
      unsubscribe();

      // Send another message
      const msg2: IframeMessageEnvelope = {
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "msg-2",
          topic: "test.topic",
          payload: { data: "world" },
          timestamp: Date.now(),
        },
      };
      mockPort.simulateMessage(msg2);

      // Handler should not be called again
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should handle subscriber errors gracefully", async () => {
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Complete handshake
      const mockPort = new MockMessagePort();
      const synEnvelope: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(synEnvelope, "https://host.example.com");

      const ackConfirmEnvelope: IframeAckConfirmEnvelope = {
        type: "pubsub:ACK_CONFIRM",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(ackConfirmEnvelope, "https://host.example.com", [
        mockPort as unknown as MessagePort,
      ]);

      await connectPromise;

      // Subscribe with handler that throws
      const errorHandler = vi.fn(() => {
        throw new Error("Handler error");
      });
      const goodHandler = vi.fn();

      client.subscribe("test.topic", errorHandler);
      client.subscribe("test.topic", goodHandler);

      // Send message
      const msg: IframeMessageEnvelope = {
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "msg-1",
          topic: "test.topic",
          payload: { data: "hello" },
          timestamp: Date.now(),
        },
      };
      mockPort.simulateMessage(msg);

      // Both handlers should be called
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(goodHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("Disconnect", () => {
    it("should send disconnect message", async () => {
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Complete handshake
      const mockPort = new MockMessagePort();
      const postMessageSpy = vi.spyOn(mockPort, "postMessage");
      const synEnvelope: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(synEnvelope, "https://host.example.com");

      const ackConfirmEnvelope: IframeAckConfirmEnvelope = {
        type: "pubsub:ACK_CONFIRM",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(ackConfirmEnvelope, "https://host.example.com", [
        mockPort as unknown as MessagePort,
      ]);

      await connectPromise;

      client.disconnect();

      expect(postMessageSpy).toHaveBeenCalledTimes(1);
      const envelope = postMessageSpy.mock.calls[0][0] as IframeDisconnectEnvelope;
      expect(envelope.type).toBe("pubsub:DISCONNECT");

      const stats = client.getStats();
      expect(stats.connected).toBe(false);
      expect(stats.disconnections).toBe(1);
    });

    it("should call onDisconnected callback", async () => {
      const onDisconnected = vi.fn();
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
        onDisconnected,
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Complete handshake
      const mockPort = new MockMessagePort();
      const synEnvelope: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(synEnvelope, "https://host.example.com");

      const ackConfirmEnvelope: IframeAckConfirmEnvelope = {
        type: "pubsub:ACK_CONFIRM",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(ackConfirmEnvelope, "https://host.example.com", [
        mockPort as unknown as MessagePort,
      ]);

      await connectPromise;

      client.disconnect();

      expect(onDisconnected).toHaveBeenCalledWith("explicit_disconnect");
    });

    it("should handle disconnect from host", async () => {
      const onDisconnected = vi.fn();
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
        onDisconnected,
        autoReconnect: false,
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Complete handshake
      const mockPort = new MockMessagePort();
      const synEnvelope: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(synEnvelope, "https://host.example.com");

      const ackConfirmEnvelope: IframeAckConfirmEnvelope = {
        type: "pubsub:ACK_CONFIRM",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(ackConfirmEnvelope, "https://host.example.com", [
        mockPort as unknown as MessagePort,
      ]);

      await connectPromise;

      // Host sends disconnect
      const disconnectEnvelope: IframeDisconnectEnvelope = {
        type: "pubsub:DISCONNECT",
        version: PROTOCOL_VERSION,
      };
      mockPort.simulateMessage(disconnectEnvelope);

      expect(onDisconnected).toHaveBeenCalledWith("explicit_disconnect");
      expect(client.getStats().connected).toBe(false);
    });
  });

  describe("Detach", () => {
    it("should be an alias for disconnect", async () => {
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Complete handshake
      const mockPort = new MockMessagePort();
      const synEnvelope: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(synEnvelope, "https://host.example.com");

      const ackConfirmEnvelope: IframeAckConfirmEnvelope = {
        type: "pubsub:ACK_CONFIRM",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(ackConfirmEnvelope, "https://host.example.com", [
        mockPort as unknown as MessagePort,
      ]);

      await connectPromise;

      client.detach();

      expect(client.getStats().connected).toBe(false);
    });
  });

  describe("GetStats", () => {
    it("should return accurate statistics", async () => {
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Complete handshake
      const mockPort = new MockMessagePort();
      const synEnvelope: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(synEnvelope, "https://host.example.com");

      const ackConfirmEnvelope: IframeAckConfirmEnvelope = {
        type: "pubsub:ACK_CONFIRM",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(ackConfirmEnvelope, "https://host.example.com", [
        mockPort as unknown as MessagePort,
      ]);

      await connectPromise;

      client.publish("test.1", {});
      client.publish("test.2", {});

      const msg1: IframeMessageEnvelope = {
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "msg-1",
          topic: "test.topic",
          payload: {},
          timestamp: Date.now(),
        },
      };
      mockPort.simulateMessage(msg1);

      client.disconnect();

      const stats = client.getStats();
      expect(stats.connected).toBe(false);
      expect(stats.messagesPublished).toBe(2);
      expect(stats.messagesReceived).toBe(1);
      expect(stats.connectionAttempts).toBe(1);
      expect(stats.disconnections).toBe(1);
    });
  });

  describe("Handshake failure scenarios", () => {
    it("should handle network timeout during handshake", async () => {
      vi.useFakeTimers();

      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
        handshakeTimeout: 5000,
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Don't send any response - simulate network timeout
      // Fast-forward past timeout
      vi.advanceTimersByTime(5000);

      await expect(connectPromise).rejects.toThrow("Handshake timeout");

      vi.useRealTimers();
    });

    it("should handle iframe removed during handshake", async () => {
      vi.useFakeTimers();

      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
        handshakeTimeout: 5000,
        autoReconnect: false,
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Simulate SYN received
      const synEnvelope: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(synEnvelope, "https://host.example.com");

      // But then timeout before ACK_CONFIRM (simulating iframe removal)
      vi.advanceTimersByTime(5000);

      await expect(connectPromise).rejects.toThrow("Handshake timeout");

      vi.useRealTimers();
    });

    it("should handle multiple rapid reconnection attempts", async () => {
      vi.useFakeTimers();

      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
        handshakeTimeout: 1000,
        autoReconnect: true,
      };

      const client = new IframeClient(config);

      // Start multiple connection attempts
      const promise1 = client.connect();

      // First attempt times out
      vi.advanceTimersByTime(1000);

      try {
        await promise1;
      } catch {
        // Expected to fail
      }

      // Auto-reconnect should trigger
      await vi.advanceTimersByTimeAsync(1100);

      const stats = client.getStats();
      expect(stats.connectionAttempts).toBeGreaterThan(1);

      vi.useRealTimers();
    });

    it("should reject cross-origin attack attempts", async () => {
      vi.useFakeTimers();
      const config: IframeClientConfig = {
        expectedHostOrigin: "https://trusted.example.com",
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Attacker tries to send SYN from different origin
      const maliciousSyn: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(maliciousSyn, "https://evil.com");

      // Wait a bit
      await vi.advanceTimersByTimeAsync(100);

      // Client should still be waiting for legitimate handshake
      const stats = client.getStats();
      expect(stats.connected).toBe(false);

      // Now send legitimate handshake
      const mockPort = new MockMessagePort();
      mockWindow.simulateMessage(maliciousSyn, "https://trusted.example.com");

      const ackConfirmEnvelope: IframeAckConfirmEnvelope = {
        type: "pubsub:ACK_CONFIRM",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(ackConfirmEnvelope, "https://trusted.example.com", [
        mockPort as unknown as MessagePort,
      ]);

      await connectPromise;
      expect(client.getStats().connected).toBe(true);

      vi.useRealTimers();
    });

    it("should reject messages with mismatched protocol version", async () => {
      vi.useFakeTimers();

      const config: IframeClientConfig = {
        expectedHostOrigin: "https://host.example.com",
      };

      const client = new IframeClient(config);
      const connectPromise = client.connect();

      // Send SYN with wrong version
      const wrongVersionSyn = {
        type: "pubsub:SYN",
        version: 999, // Wrong version
      };
      mockWindow.simulateMessage(wrongVersionSyn, "https://host.example.com");

      // Wait a bit
      vi.advanceTimersByTime(100);

      // Should not connect with wrong version
      expect(client.getStats().connected).toBe(false);

      // Now send correct version
      const mockPort = new MockMessagePort();
      const correctSyn: IframeSynEnvelope = {
        type: "pubsub:SYN",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(correctSyn, "https://host.example.com");

      const ackConfirm: IframeAckConfirmEnvelope = {
        type: "pubsub:ACK_CONFIRM",
        version: PROTOCOL_VERSION,
      };
      mockWindow.simulateMessage(ackConfirm, "https://host.example.com", [
        mockPort as unknown as MessagePort,
      ]);

      await connectPromise;
      expect(client.getStats().connected).toBe(true);

      vi.useRealTimers();
    });
  });
});
