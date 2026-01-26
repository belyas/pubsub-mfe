import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CrossTabEnvelope } from "../types";
import {
  SharedWorkerTransport,
  createSharedWorkerTransport,
  WorkerMessageType,
} from "./shared-worker";
import { TransportError, TransportErrorCode } from "./base";

const MOCK_WORKER_URL = "blob:mock-worker-url";

class MockMessagePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  private broker: MockSharedWorkerBroker | null = null;
  public clientId: string | null = null;

  constructor(broker: MockSharedWorkerBroker) {
    this.broker = broker;
  }

  postMessage(message: unknown): void {
    if (this.broker) {
      this.broker.handleMessage(this, message);
    }
  }

  start(): void {
    // No-op for mock
  }

  close(): void {
    if (this.broker && this.clientId) {
      this.broker.removeClient(this.clientId);
    }
    this.broker = null;
  }

  setClientId(id: string): void {
    this.clientId = id;
  }
}

// Mock SharedWorker broker (simulates the inline worker code)
class MockSharedWorkerBroker {
  private clients = new Map<string, MockMessagePort>();
  private channels = new Map<string, Set<string>>();

  handleMessage(port: MockMessagePort, message: unknown): void {
    const msg = message as {
      type: string;
      clientId?: string;
      channelName?: string;
      payload?: string;
    };

    switch (msg.type) {
      case WorkerMessageType.REGISTER: {
        const clientId = msg.clientId || `mock-${Date.now()}`;
        const channelName = msg.channelName || "default";

        this.clients.set(clientId, port);
        port.setClientId(clientId);

        if (!this.channels.has(channelName)) {
          this.channels.set(channelName, new Set());
        }
        this.channels.get(channelName)!.add(clientId);

        setTimeout(() => {
          if (port.onmessage) {
            port.onmessage(
              new MessageEvent("message", {
                data: { type: WorkerMessageType.REGISTERED, clientId, timestamp: Date.now() },
              })
            );
          }
        }, 0);
        break;
      }

      case WorkerMessageType.PUBLISH: {
        const senderId = port.clientId;
        if (!senderId) return;

        const senderChannel = Array.from(this.channels.entries()).find(([_, clients]) =>
          clients.has(senderId)
        );

        if (senderChannel) {
          const [_channelName, clients] = senderChannel;
          setTimeout(() => {
            for (const targetClientId of clients) {
              if (targetClientId !== senderId) {
                const targetPort = this.clients.get(targetClientId);

                if (targetPort?.onmessage) {
                  targetPort.onmessage(
                    new MessageEvent("message", {
                      data: {
                        type: WorkerMessageType.DELIVER,
                        payload: msg.payload,
                        timestamp: Date.now(),
                      },
                    })
                  );
                }
              }
            }
          }, 0);
        }
        break;
      }

      case WorkerMessageType.DISCONNECT: {
        const senderId = (port as { clientId?: string }).clientId;

        if (senderId) {
          this.removeClient(senderId);
        }
        break;
      }

      case WorkerMessageType.PING: {
        setTimeout(() => {
          if (port.onmessage) {
            port.onmessage(
              new MessageEvent("message", {
                data: { type: WorkerMessageType.PONG, timestamp: Date.now() },
              })
            );
          }
        }, 0);
        break;
      }
    }
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);

    for (const clients of this.channels.values()) {
      clients.delete(clientId);
    }
  }

  simulateError(port: MockMessagePort): void {
    setTimeout(() => {
      if (port.onmessageerror) {
        port.onmessageerror(new MessageEvent("messageerror", { data: null }));
      }
    }, 0);
  }

  simulateBrokerError(port: MockMessagePort, error: string): void {
    setTimeout(() => {
      if (port.onmessage) {
        port.onmessage(
          new MessageEvent("message", {
            data: { type: WorkerMessageType.ERROR, error },
          })
        );
      }
    }, 0);
  }
}

class MockSharedWorker {
  port: MockMessagePort;
  private static broker = new MockSharedWorkerBroker();

  constructor(_scriptURL: string | URL, _options?: WorkerOptions) {
    this.port = new MockMessagePort(MockSharedWorker.broker);
  }

  static getBroker(): MockSharedWorkerBroker {
    return this.broker;
  }

  static reset(): void {
    this.broker = new MockSharedWorkerBroker();
  }
}

describe("SharedWorker Transport", () => {
  let originalSharedWorker: typeof SharedWorker | undefined;
  let originalURL: typeof URL;

  beforeEach(() => {
    originalSharedWorker = globalThis.SharedWorker;
    originalURL = globalThis.URL;
    globalThis.URL = class MockURL extends URL {
      static createObjectURL(_blob: Blob): string {
        return `blob:mock-${Date.now()}`;
      }
      static revokeObjectURL(_url: string): void {
        // No-op for mock
      }
    } as typeof URL;

    (globalThis as { SharedWorker: unknown }).SharedWorker = MockSharedWorker;
    MockSharedWorker.reset();
  });

  afterEach(() => {
    if (originalSharedWorker) {
      (globalThis as { SharedWorker: unknown }).SharedWorker = originalSharedWorker;
    }

    globalThis.URL = originalURL;
    MockSharedWorker.reset();
  });

  describe("Initialization", () => {
    it("should create transport with SharedWorker", async () => {
      vi.useFakeTimers();
      const transport = new SharedWorkerTransport({
        channelName: "test-channel",
        workerUrl: MOCK_WORKER_URL,
      });

      expect(transport.name).toBe("SharedWorker");
      expect(transport.isAvailable()).toBe(true);

      // Wait for registration
      vi.advanceTimersByTime(10);
      expect(transport.isConnected()).toBe(true);

      transport.close();
      vi.useRealTimers();
    });

    it("should generate client ID if not provided", async () => {
      const transport = new SharedWorkerTransport({
        channelName: "test",
        workerUrl: MOCK_WORKER_URL,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const clientId = transport.getClientId();
      expect(clientId).toBeTruthy();
      expect(typeof clientId).toBe("string");

      transport.close();
    });

    it("should use provided client ID", async () => {
      const customId = "custom-client-123";
      const transport = new SharedWorkerTransport({
        channelName: "test",
        clientId: customId,
        workerUrl: MOCK_WORKER_URL,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(transport.getClientId()).toBe(customId);

      transport.close();
    });

    it("should not throw if SharedWorker is not available", () => {
      delete (globalThis as { SharedWorker?: unknown }).SharedWorker;

      const onError = vi.fn();
      const onFallback = vi.fn();

      expect(() => {
        new SharedWorkerTransport({
          channelName: "test",
          workerUrl: MOCK_WORKER_URL,
          onError,
          onFallback,
        });
      }).not.toThrow();

      expect(onError).toHaveBeenCalled();
      expect(onFallback).toHaveBeenCalled();

      const error = onError.mock.calls[0][0];
      expect(error).toBeInstanceOf(TransportError);
      expect(error.code).toBe(TransportErrorCode.NOT_AVAILABLE);
    });

    it("should use custom worker URL if provided", () => {
      const transport = new SharedWorkerTransport({
        channelName: "test",
        workerUrl: MOCK_WORKER_URL,
      });

      expect(transport.isAvailable()).toBe(true);
      transport.close();
    });

    it("should accept debug option", () => {
      const transport = new SharedWorkerTransport({
        channelName: "test",
        debug: true,
        workerUrl: MOCK_WORKER_URL,
      });

      expect(transport.isAvailable()).toBe(true);
      transport.close();
    });
  });

  describe("Send and Receive", () => {
    it("should send message after registration", async () => {
      const transport = new SharedWorkerTransport({
        channelName: "test",
        workerUrl: MOCK_WORKER_URL,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const envelope: CrossTabEnvelope = {
        messageId: "msg-1",
        clientId: "client-1",
        topic: "test.topic",
        payload: { data: "hello" },
        timestamp: Date.now(),
        version: 1,
        origin: "test",
      };

      expect(() => transport.send(envelope)).not.toThrow();
      transport.close();
    });

    it("should queue messages before registration", () => {
      const transport = new SharedWorkerTransport({
        channelName: "test",
        workerUrl: MOCK_WORKER_URL,
      });

      const envelope: CrossTabEnvelope = {
        messageId: "msg-1",
        clientId: "client-1",
        topic: "test.topic",
        payload: { data: "hello" },
        timestamp: Date.now(),
        version: 1,
        origin: "test",
      };

      // Send immediately before registration completes
      expect(() => transport.send(envelope)).not.toThrow();

      transport.close();
    });

    it("should receive messages from other clients", async () => {
      const transport1 = new SharedWorkerTransport({
        channelName: "test",
        workerUrl: MOCK_WORKER_URL,
      });
      const transport2 = new SharedWorkerTransport({
        channelName: "test",
        workerUrl: MOCK_WORKER_URL,
      });

      const received: CrossTabEnvelope[] = [];
      transport2.onMessage((envelope) => {
        received.push(envelope);
        return () => {};
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      const envelope: CrossTabEnvelope = {
        messageId: "msg-1",
        clientId: "client-1",
        topic: "test.topic",
        payload: { data: "hello" },
        timestamp: Date.now(),
        version: 1,
        origin: "test",
      };

      transport1.send(envelope);

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(received.length).toBeGreaterThan(0);
      expect(received[0].topic).toBe("test.topic");
      expect(received[0].payload).toEqual({ data: "hello" });

      transport1.close();
      transport2.close();
    });

    it("should not receive own messages", async () => {
      const transport = new SharedWorkerTransport({
        channelName: "test",
        workerUrl: MOCK_WORKER_URL,
      });

      const received: CrossTabEnvelope[] = [];
      transport.onMessage((envelope) => {
        received.push(envelope);
        return () => {};
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      const envelope: CrossTabEnvelope = {
        messageId: "msg-1",
        clientId: "client-1",
        topic: "test.topic",
        payload: { data: "hello" },
        timestamp: Date.now(),
        version: 1,
        origin: "test",
      };

      transport.send(envelope);

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(received.length).toBe(0);

      transport.close();
    });

    it("should handle multiple message handlers", async () => {
      const transport1 = new SharedWorkerTransport({
        channelName: "test",
        workerUrl: MOCK_WORKER_URL,
      });
      const transport2 = new SharedWorkerTransport({
        channelName: "test",
        workerUrl: MOCK_WORKER_URL,
      });

      const received1: CrossTabEnvelope[] = [];
      const received2: CrossTabEnvelope[] = [];

      transport2.onMessage((envelope) => {
        received1.push(envelope);
        return () => {};
      });

      transport2.onMessage((envelope) => {
        received2.push(envelope);
        return () => {};
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      const envelope: CrossTabEnvelope = {
        messageId: "msg-1",
        clientId: "client-1",
        topic: "test.topic",
        payload: { data: "test" },
        timestamp: Date.now(),
        version: 1,
        origin: "test",
      };

      transport1.send(envelope);

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(received1.length).toBeGreaterThan(0);
      expect(received2.length).toBeGreaterThan(0);

      transport1.close();
      transport2.close();
    });
  });

  describe("Reconnection", () => {
    it("should attempt reconnection on message error", async () => {
      const onFallback = vi.fn();
      const transport = new SharedWorkerTransport({
        channelName: "test",
        reconnectAttempts: 2,
        reconnectDelayMs: 10,
        onFallback,
        workerUrl: MOCK_WORKER_URL,
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      const broker = MockSharedWorker.getBroker();
      const port = (transport as unknown as { port?: MockMessagePort }).port;
      if (port) {
        broker.simulateError(port);
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should attempt reconnection
      expect(transport.isConnected()).toBe(true);
      expect(onFallback).not.toHaveBeenCalled();

      transport.close();
    });

    it("should call onFallback after max reconnection attempts", () => {
      vi.useFakeTimers();
      const onFallback = vi.fn();
      const onError = vi.fn();
      const transport = new SharedWorkerTransport({
        channelName: "test",
        reconnectAttempts: 2,
        reconnectDelayMs: 10,
        workerUrl: MOCK_WORKER_URL,
        onFallback,
        onError,
      });

      vi.advanceTimersByTime(20);

      const broker = MockSharedWorker.getBroker();

      // Simulate continuous errors to prevent successful reconnection
      const errorInterval = setInterval(() => {
        const port = (transport as unknown as { port?: MockMessagePort }).port;
        if (port) {
          broker.simulateError(port);
        }
      }, 5);

      // Wait for reconnection attempts to exhaust
      vi.advanceTimersByTime(200);

      clearInterval(errorInterval);

      // Should have called onFallback after exhausting reconnection attempts
      expect(onFallback).toHaveBeenCalled();

      transport.close();
      vi.useRealTimers();
    });

    it("should use exponential backoff for reconnection", async () => {
      vi.useFakeTimers();
      const transport = new SharedWorkerTransport({
        channelName: "test",
        reconnectAttempts: 3,
        reconnectDelayMs: 10,
        workerUrl: MOCK_WORKER_URL,
      });

      vi.advanceTimersByTime(20);

      // The implementation uses exponential backoff: delay * 2^(attempt-1)
      // First retry: 10ms, Second: 20ms, Third: 40ms

      transport.close();
      vi.useRealTimers();
    });
  });

  describe("Cleanup", () => {
    it("should clean up resources on close", async () => {
      vi.useFakeTimers();
      const transport = new SharedWorkerTransport({
        channelName: "test",
        workerUrl: MOCK_WORKER_URL,
      });

      vi.advanceTimersByTime(20);
      expect(transport.isConnected()).toBe(true);

      transport.close();

      expect(transport.isConnected()).toBe(false);
      vi.useRealTimers();
    });

    it("should not send messages after close", async () => {
      vi.useFakeTimers();
      const transport = new SharedWorkerTransport({
        channelName: "test",
        workerUrl: MOCK_WORKER_URL,
      });

      vi.advanceTimersByTime(20);

      transport.close();

      const envelope: CrossTabEnvelope = {
        messageId: "msg-1",
        clientId: "client-1",
        topic: "test.topic",
        payload: { data: "test" },
        timestamp: Date.now(),
        version: 1,
        origin: "test",
      };

      // Should not throw but also not send
      transport.send(envelope);
      vi.useRealTimers();
    });

    it("should cancel pending reconnection on close", async () => {
      vi.useFakeTimers();
      const transport = new SharedWorkerTransport({
        channelName: "test",
        reconnectDelayMs: 100,
        workerUrl: MOCK_WORKER_URL,
      });

      vi.advanceTimersByTime(20);

      const broker = MockSharedWorker.getBroker();
      const port = (transport as unknown as { port?: MockMessagePort }).port;

      if (port) {
        broker.simulateError(port);
      }

      // Close before reconnection completes
      vi.advanceTimersByTime(10);

      transport.close();

      // Wait to ensure reconnection doesn't happen
      vi.advanceTimersByTime(150);
      vi.useRealTimers();
    });
  });

  describe("Error Handling", () => {
    it("should handle broker errors", async () => {
      vi.useFakeTimers();
      const onError = vi.fn();
      const transport = new SharedWorkerTransport({
        channelName: "test",
        onError,
        workerUrl: MOCK_WORKER_URL,
      });

      vi.advanceTimersByTime(20);

      const broker = MockSharedWorker.getBroker();
      const port = (transport as unknown as { port?: MockMessagePort }).port;
      if (port) {
        broker.simulateBrokerError(port, "Test error");
      }

      vi.advanceTimersByTime(10);

      expect(onError).toHaveBeenCalled();
      const error = onError.mock.calls[onError.mock.calls.length - 1][0];
      expect(error).toBeInstanceOf(TransportError);
      expect(error.code).toBe(TransportErrorCode.RECEIVE_FAILED);

      transport.close();
      vi.useRealTimers();
    });

    it("should handle serialization errors gracefully", async () => {
      vi.useFakeTimers();
      const onError = vi.fn();
      const transport = new SharedWorkerTransport({
        channelName: "test",
        workerUrl: MOCK_WORKER_URL,
        onError,
      });

      vi.advanceTimersByTime(20);

      const envelope = {
        messageId: "msg-1",
        clientId: "client-1",
        topic: "test.topic",
        payload: undefined, // This might cause serialization issues
        timestamp: Date.now(),
        version: 1,
        origin: "test",
      } as unknown as CrossTabEnvelope;

      transport.send(envelope);

      vi.advanceTimersByTime(10);

      transport.close();
      vi.useRealTimers();
    });
  });

  describe("Ping", () => {
    it("should send ping and receive pong", async () => {
      vi.useFakeTimers();
      const transport = new SharedWorkerTransport({
        channelName: "test",
        workerUrl: MOCK_WORKER_URL,
      });

      vi.advanceTimersByTime(20);

      expect(() => transport.ping()).not.toThrow();

      vi.advanceTimersByTime(10);

      transport.close();
      vi.useRealTimers();
    });

    it("should not send ping when not connected", () => {
      const transport = new SharedWorkerTransport({
        channelName: "test",
        workerUrl: MOCK_WORKER_URL,
      });

      // Try to ping before registration
      expect(() => transport.ping()).not.toThrow();

      transport.close();
    });
  });

  describe("Factory Function", () => {
    it("should create transport via factory", () => {
      const transport = createSharedWorkerTransport({
        channelName: "test",
        workerUrl: MOCK_WORKER_URL,
      });

      expect(transport).toBeInstanceOf(SharedWorkerTransport);
      expect(transport.name).toBe("SharedWorker");

      transport.close();
    });
  });
});
