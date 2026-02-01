import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPubSub } from "../../bus";
import { createIframeHost, IframeHost, PROTOCOL_VERSION } from "./host";
import type { IframeHostConfig, IframeAckEnvelope, IframeMessageEnvelope } from "./types";

class MockIframe {
  contentWindow: {
    postMessage: ReturnType<typeof vi.fn>;
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  listeners = new Map<string, Set<Function>>();

  constructor() {
    this.contentWindow = {
      postMessage: vi.fn(),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  addEventListener(event: string, handler: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  removeEventListener(event: string, handler: Function): void {
    this.listeners.get(event)?.delete(handler);
  }

  simulateLoad(): void {
    const loadListeners = this.listeners.get("load") || new Set();
    for (const listener of loadListeners) {
      listener();
    }
  }
}

describe("IframeHost", () => {
  let host: IframeHost;
  let bus: ReturnType<typeof createPubSub>;
  let iframe: MockIframe;
  const trustedOrigin = "https://child.example.com";

  beforeEach(() => {
    bus = createPubSub();
    iframe = new MockIframe();
  });

  afterEach(() => {
    host?.detach();
  });

  describe("Constructor", () => {
    it("should create instance with required config", () => {
      host = new IframeHost({
        trustedOrigins: [trustedOrigin],
      });

      expect(host).toBeInstanceOf(IframeHost);
    });

    it("should apply default config values", () => {
      host = new IframeHost({
        trustedOrigins: [trustedOrigin],
      });
      host.attach(bus);

      const stats = host.getStats();
      expect(stats.totalIframes).toBe(0);
    });
  });

  describe("Attach/Detach", () => {
    it("should attach to bus and setup listeners", () => {
      const config: IframeHostConfig = {
        trustedOrigins: [trustedOrigin],
      };
      host = createIframeHost(bus, config);

      const stats = host.getStats();
      expect(stats.totalIframes).toBe(0);
    });

    it("should not attach twice", () => {
      const config: IframeHostConfig = {
        trustedOrigins: [trustedOrigin],
        debug: true,
      };
      host = new IframeHost(config);
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      host.attach(bus);
      host.attach(bus);

      expect(consoleSpy).toHaveBeenCalledWith("[IframeHost]", "Already attached");
      consoleSpy.mockRestore();
    });

    it("should detach and cleanup all iframes", () => {
      host = createIframeHost(bus, {
        trustedOrigins: [trustedOrigin],
      });

      host.detach();

      const stats = host.getStats();
      expect(stats.connectedIframes).toBe(0);
    });
  });

  describe("RegisterIframe", () => {
    it("should reject registration before attach", async () => {
      host = new IframeHost({
        trustedOrigins: [trustedOrigin],
      });

      await expect(host.registerIframe(iframe as any, trustedOrigin)).rejects.toThrow(
        "IframeHost must be attached before registering iframes"
      );
    });

    it("should reject untrusted origin", async () => {
      host = createIframeHost(bus, {
        trustedOrigins: [trustedOrigin],
      });

      await expect(host.registerIframe(iframe as any, "https://evil.com")).rejects.toThrow(
        "Untrusted origin: https://evil.com"
      );
    });

    it("should send SYN message on registration", async () => {
      host = createIframeHost(bus, {
        trustedOrigins: [trustedOrigin],
        handshakeTimeout: 100,
      });

      const registerPromise = host.registerIframe(iframe as any, trustedOrigin);

      expect(iframe.contentWindow.postMessage).toHaveBeenCalledWith(
        {
          type: "pubsub:SYN",
          version: PROTOCOL_VERSION,
        },
        trustedOrigin
      );

      // Don't wait for handshake to complete (will timeout)
      await expect(registerPromise).rejects.toThrow("Handshake timeout");
    });

    it("should handle handshake timeout", async () => {
      const onHandshakeFailed = vi.fn();
      host = createIframeHost(bus, {
        trustedOrigins: [trustedOrigin],
        handshakeTimeout: 50,
        maxRetries: 0,
        onHandshakeFailed,
      });

      await expect(host.registerIframe(iframe as any, trustedOrigin)).rejects.toThrow(
        "Handshake timeout"
      );

      expect(onHandshakeFailed).toHaveBeenCalledWith(iframe, trustedOrigin, expect.any(Error));
    });

    it("should retry handshake on timeout", async () => {
      host = createIframeHost(bus, {
        trustedOrigins: [trustedOrigin],
        handshakeTimeout: 50,
        maxRetries: 2,
      });

      const registerPromise = host.registerIframe(iframe as any, trustedOrigin);

      await expect(registerPromise).rejects.toThrow("Handshake timeout");

      // Should have sent SYN 3 times (initial + 2 retries)
      expect(iframe.contentWindow.postMessage).toHaveBeenCalledTimes(3);
    });

    it("should complete handshake on ACK", async () => {
      const onHandshakeComplete = vi.fn();
      host = createIframeHost(bus, {
        trustedOrigins: [trustedOrigin],
        onHandshakeComplete,
      });
      const registerPromise = host.registerIframe(iframe as any, trustedOrigin);

      // Simulate ACK response
      const ack: IframeAckEnvelope = {
        type: "pubsub:ACK",
        version: 1,
        clientId: "client-123",
        capabilities: [],
      };
      window.dispatchEvent(
        new MessageEvent("message", {
          data: ack,
          origin: trustedOrigin,
        })
      );

      await registerPromise;

      expect(onHandshakeComplete).toHaveBeenCalledWith(iframe, "client-123");

      const stats = host.getStats();
      expect(stats.connectedIframes).toBe(1);
    });

    it("should reject ACK from untrusted origin", async () => {
      host = createIframeHost(bus, {
        trustedOrigins: [trustedOrigin],
        handshakeTimeout: 100,
      });
      const registerPromise = host.registerIframe(iframe as any, trustedOrigin);
      // Simulate ACK from wrong origin
      const ack: IframeAckEnvelope = {
        type: "pubsub:ACK",
        version: 1,
        clientId: "client-123",
        capabilities: [],
      };

      window.dispatchEvent(
        new MessageEvent("message", {
          data: ack,
          origin: "https://evil.com",
        })
      );

      // Should timeout (ACK rejected)
      await expect(registerPromise).rejects.toThrow("Handshake timeout");
    });

    it("should not register same iframe twice", async () => {
      const onHandshakeComplete = vi.fn();
      host = createIframeHost(bus, {
        trustedOrigins: [trustedOrigin],
        onHandshakeComplete,
      });
      // First registration
      const registerPromise1 = host.registerIframe(iframe as any, trustedOrigin);
      const ack: IframeAckEnvelope = {
        type: "pubsub:ACK",
        version: 1,
        clientId: "client-123",
        capabilities: [],
      };
      window.dispatchEvent(
        new MessageEvent("message", {
          data: ack,
          origin: trustedOrigin,
        })
      );
      await registerPromise1;

      // Second registration (should warn and return)
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await host.registerIframe(iframe as any, trustedOrigin);
      expect(consoleSpy).toHaveBeenCalledWith(
        "[IframeHost]",
        expect.stringContaining("already registered")
      );
      consoleSpy.mockRestore();
    });
  });

  describe("Message routing", () => {
    let mockPort: {
      postMessage: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      onmessage: ((event: MessageEvent) => void) | null;
      onmessageerror: (() => void) | null;
    };

    beforeEach(async () => {
      mockPort = {
        postMessage: vi.fn(),
        close: vi.fn(),
        onmessage: null,
        onmessageerror: null,
      };

      const originalMessageChannel = globalThis.MessageChannel;

      (globalThis as any).MessageChannel = class MockMessageChannel {
        port1 = mockPort;
        port2 = {};
      };

      host = createIframeHost(bus, {
        trustedOrigins: [trustedOrigin],
      });
      // Register and complete handshake
      const registerPromise = host.registerIframe(iframe as any, trustedOrigin);
      const ack: IframeAckEnvelope = {
        type: "pubsub:ACK",
        version: 1,
        clientId: "client-123",
        capabilities: [],
      };
      window.dispatchEvent(
        new MessageEvent("message", {
          data: ack,
          origin: trustedOrigin,
        })
      );
      await registerPromise;

      (globalThis as any).MessageChannel = originalMessageChannel;
    });

    it("should broadcast bus messages to iframe", async () => {
      bus.publish("test.topic", { data: "hello" });

      // Wait a tick for async message handling
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "pubsub:MESSAGE",
          payload: expect.objectContaining({
            topic: "test.topic",
            payload: { data: "hello" },
          }),
        })
      );
    });

    it("should receive messages from iframe and publish to bus", async () => {
      const subscriber = vi.fn();
      bus.subscribe("iframe.test", subscriber);

      const message: IframeMessageEnvelope = {
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "msg-123",
          topic: "iframe.test",
          payload: { data: "from-iframe" },
          timestamp: Date.now(),
        },
      };

      mockPort.onmessage!(new MessageEvent("message", { data: message }));

      // Wait a tick for async message handling
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(subscriber).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: "iframe.test",
          payload: { data: "from-iframe" },
        })
      );
    });

    it("should track message stats", async () => {
      bus.publish("test.topic", { data: "hello" });

      // Wait a tick for async message handling
      await new Promise((resolve) => setTimeout(resolve, 10));

      const stats = host.getStats();
      expect(stats.messagesSent).toBe(1);
    });
  });

  describe("Disconnect detection", () => {
    let mockPort: {
      postMessage: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      onmessage: ((event: MessageEvent) => void) | null;
      onmessageerror: (() => void) | null;
    };

    beforeEach(async () => {
      mockPort = {
        postMessage: vi.fn(),
        close: vi.fn(),
        onmessage: null,
        onmessageerror: null,
      };

      const originalMessageChannel = globalThis.MessageChannel;

      (globalThis as any).MessageChannel = class MockMessageChannel {
        port1 = mockPort;
        port2 = {};
      };

      host = createIframeHost(bus, {
        trustedOrigins: [trustedOrigin],
      });
      const registerPromise = host.registerIframe(iframe as any, trustedOrigin);
      const ack: IframeAckEnvelope = {
        type: "pubsub:ACK",
        version: 1,
        clientId: "client-123",
        capabilities: [],
      };

      window.dispatchEvent(
        new MessageEvent("message", {
          data: ack,
          origin: trustedOrigin,
        })
      );

      await registerPromise;

      (globalThis as any).MessageChannel = originalMessageChannel;
    });

    it("should handle explicit disconnect message", () => {
      const disconnect = {
        type: "pubsub:DISCONNECT" as const,
        version: PROTOCOL_VERSION,
      };

      mockPort.onmessage!(new MessageEvent("message", { data: disconnect }));

      const stats = host.getStats();
      expect(stats.connectedIframes).toBe(0);
    });

    it("should handle passive disconnect (send failure)", async () => {
      mockPort.postMessage.mockImplementation(() => {
        throw new Error("Port closed");
      });

      bus.publish("test.topic", { data: "hello" });

      // Wait a tick for async disconnect handling
      await new Promise((resolve) => setTimeout(resolve, 10));

      const stats = host.getStats();
      expect(stats.connectedIframes).toBe(0);
    });

    it("should track dropped messages", async () => {
      mockPort.postMessage.mockImplementation(() => {
        throw new Error("Port closed");
      });

      bus.publish("test.topic", { data: "hello" });

      // Wait a tick for async disconnect handling
      await new Promise((resolve) => setTimeout(resolve, 10));

      const stats = host.getStats();
      expect(stats.messagesDropped).toBeGreaterThan(0);
    });
  });

  describe("Auto-reconnect", () => {
    it("should setup load listener when autoReconnect enabled", async () => {
      host = createIframeHost(bus, {
        trustedOrigins: [trustedOrigin],
        autoReconnect: true,
        handshakeTimeout: 100,
      });
      const registerPromise = host.registerIframe(iframe as any, trustedOrigin);
      const ack: IframeAckEnvelope = {
        type: "pubsub:ACK",
        version: PROTOCOL_VERSION,
        clientId: "client-123",
        capabilities: [],
      };

      window.dispatchEvent(
        new MessageEvent("message", {
          data: ack,
          origin: trustedOrigin,
        })
      );

      await registerPromise;

      // Verify load listener registered
      expect(iframe.listeners.get("load")?.size).toBeGreaterThan(0);
    });

    it("should not setup load listener when autoReconnect disabled", async () => {
      host = createIframeHost(bus, {
        trustedOrigins: [trustedOrigin],
        autoReconnect: false,
        handshakeTimeout: 100,
      });
      const registerPromise = host.registerIframe(iframe as any, trustedOrigin);
      const ack: IframeAckEnvelope = {
        type: "pubsub:ACK",
        version: PROTOCOL_VERSION,
        clientId: "client-123",
        capabilities: [],
      };

      window.dispatchEvent(
        new MessageEvent("message", {
          data: ack,
          origin: trustedOrigin,
        })
      );

      await registerPromise;

      expect(iframe.listeners.get("load")?.size || 0).toBe(0);
    });
  });

  describe("UnregisterIframe", () => {
    it("should unregister iframe and send disconnect", async () => {
      let mockPort: any;
      const originalMessageChannel = globalThis.MessageChannel;

      (globalThis as any).MessageChannel = class MockMessageChannel {
        port1 = {
          postMessage: vi.fn(),
          close: vi.fn(),
          onmessage: null,
          onmessageerror: null,
        };
        port2 = {};
        constructor() {
          mockPort = this.port1;
        }
      };

      host = createIframeHost(bus, {
        trustedOrigins: [trustedOrigin],
      });
      const registerPromise = host.registerIframe(iframe as any, trustedOrigin);
      const ack: IframeAckEnvelope = {
        type: "pubsub:ACK",
        version: PROTOCOL_VERSION,
        clientId: "client-123",
        capabilities: [],
      };

      window.dispatchEvent(
        new MessageEvent("message", {
          data: ack,
          origin: trustedOrigin,
        })
      );

      await registerPromise;

      host.unregisterIframe(iframe as any);

      expect(mockPort.close).toHaveBeenCalled();
      const stats = host.getStats();
      expect(stats.connectedIframes).toBe(0);

      (globalThis as any).MessageChannel = originalMessageChannel;
    });

    it("should warn if iframe not registered", () => {
      host = createIframeHost(bus, {
        trustedOrigins: [trustedOrigin],
      });
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      host.unregisterIframe(iframe as any);

      expect(consoleSpy).toHaveBeenCalledWith("[IframeHost]", "Iframe not registered");
      consoleSpy.mockRestore();
    });
  });

  describe("GetStats", () => {
    it("should return accurate statistics", async () => {
      const originalMessageChannel = globalThis.MessageChannel;

      (globalThis as any).MessageChannel = class MockMessageChannel {
        port1 = {
          postMessage: vi.fn(),
          close: vi.fn(),
          onmessage: null,
          onmessageerror: null,
        };
        port2 = {};
      };

      host = createIframeHost(bus, {
        trustedOrigins: [trustedOrigin],
      });
      const registerPromise = host.registerIframe(iframe as any, trustedOrigin);
      const ack: IframeAckEnvelope = {
        type: "pubsub:ACK",
        version: 1,
        clientId: "client-123",
        capabilities: [],
      };

      window.dispatchEvent(
        new MessageEvent("message", {
          data: ack,
          origin: trustedOrigin,
        })
      );

      await registerPromise;

      bus.publish("test.topic", { data: "hello" });

      // Wait a tick for async message handling
      await new Promise((resolve) => setTimeout(resolve, 10));

      const stats = host.getStats();
      expect(stats.totalIframes).toBe(1);
      expect(stats.connectedIframes).toBe(1);
      expect(stats.messagesSent).toBe(1);

      (globalThis as any).MessageChannel = originalMessageChannel;
    });
  });

  describe("Schema validation", () => {
    let mockPort: {
      postMessage: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      onmessage: ((event: MessageEvent) => void) | null;
      onmessageerror: (() => void) | null;
    };

    beforeEach(async () => {
      mockPort = {
        postMessage: vi.fn(),
        close: vi.fn(),
        onmessage: null,
        onmessageerror: null,
      };

      const originalMessageChannel = globalThis.MessageChannel;

      (globalThis as any).MessageChannel = class MockMessageChannel {
        port1 = mockPort;
        port2 = {};
      };

      host = createIframeHost(bus, {
        trustedOrigins: [trustedOrigin],
      });
      const registerPromise = host.registerIframe(iframe as any, trustedOrigin);
      const ack: IframeAckEnvelope = {
        type: "pubsub:ACK",
        version: PROTOCOL_VERSION,
        clientId: "client-123",
        capabilities: [],
      };

      window.dispatchEvent(
        new MessageEvent("message", {
          data: ack,
          origin: trustedOrigin,
        })
      );

      await registerPromise;

      (globalThis as any).MessageChannel = originalMessageChannel;
    });

    it("should include schemaVersion in messages sent to iframe", async () => {
      bus.registerSchema("test.event@1", {
        type: "object",
        properties: { data: { type: "string" } },
        required: ["data"],
      });

      bus.publish("test.topic", { data: "hello" }, { schemaVersion: "test.event@1" });

      // Wait for async
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "pubsub:MESSAGE",
          payload: expect.objectContaining({
            topic: "test.topic",
            schemaVersion: "test.event@1",
          }),
        })
      );
    });

    it("should forward messages from iframe with schemaVersion", async () => {
      const subscriber = vi.fn();
      bus.subscribe("iframe.test", subscriber);
      const message: IframeMessageEnvelope = {
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "msg-123",
          topic: "iframe.test",
          payload: { value: 42 },
          timestamp: Date.now(),
          schemaVersion: "iframe.event@1",
        },
      };

      mockPort.onmessage!(new MessageEvent("message", { data: message }));

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(subscriber).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: "iframe.test",
          schemaVersion: "iframe.event@1",
        })
      );
    });

    it("should enforce schema validation when enabled", async () => {
      const strictBus = createPubSub({ validationMode: "strict" });
      const onValidationError = vi.fn();
      const validationHost = createIframeHost(strictBus, {
        trustedOrigins: [trustedOrigin],
        enforceSchemaValidation: true,
        onValidationError,
      });
      const validationMockPort = {
        postMessage: vi.fn(),
        close: vi.fn(),
        onmessage: null as ((event: MessageEvent) => void) | null,
        onmessageerror: null as (() => void) | null,
      };

      const originalMessageChannel = globalThis.MessageChannel;

      (globalThis as any).MessageChannel = class MockMessageChannel {
        port1 = validationMockPort;
        port2 = {};
      };

      const registerPromise = validationHost.registerIframe(iframe as any, trustedOrigin);
      const ack: IframeAckEnvelope = {
        type: "pubsub:ACK",
        version: PROTOCOL_VERSION,
        clientId: "client-456",
        capabilities: [],
      };

      window.dispatchEvent(
        new MessageEvent("message", {
          data: ack,
          origin: trustedOrigin,
        })
      );

      await registerPromise;

      strictBus.registerSchema("strict.event@1", {
        type: "object",
        properties: { someField: { type: "string" } },
        required: ["someField"],
      });

      const invalidMessage: IframeMessageEnvelope = {
        type: "pubsub:MESSAGE",
        version: PROTOCOL_VERSION,
        payload: {
          messageId: "msg-456",
          topic: "strict.topic",
          payload: { wrongField: "oops" },
          timestamp: Date.now(),
          schemaVersion: "strict.event@1",
        },
      };

      validationMockPort.onmessage!(new MessageEvent("message", { data: invalidMessage }));

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onValidationError).toHaveBeenCalledWith(iframe, "strict.topic", expect.any(Error));

      validationHost.detach();
      globalThis.MessageChannel = originalMessageChannel;
    });
  });
});
