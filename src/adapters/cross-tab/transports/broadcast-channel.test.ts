import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CrossTabEnvelope } from "../types";
import { BroadcastChannelTransport, createBroadcastChannelTransport } from "./broadcast-channel";
import { TransportError, TransportErrorCode } from "./base";

// Mock BroadcastChannel for testing
class MockBroadcastChannel {
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  private static channels = new Map<string, MockBroadcastChannel[]>();

  constructor(name: string) {
    this.name = name;

    if (!MockBroadcastChannel.channels.has(name)) {
      MockBroadcastChannel.channels.set(name, []);
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    MockBroadcastChannel.channels.get(name)!.push(this);
  }

  postMessage(message: unknown): void {
    // Simulate broadcasting to all other channels with the same name
    const channels = MockBroadcastChannel.channels.get(this.name) || [];

    // Schedule async delivery (simulate real BroadcastChannel behavior)
    setTimeout(() => {
      for (const channel of channels) {
        if (channel !== this && channel.onmessage) {
          channel.onmessage(new MessageEvent("message", { data: message }));
        }
      }
    }, 0);
  }

  close(): void {
    const channels = MockBroadcastChannel.channels.get(this.name);
    if (channels) {
      const index = channels.indexOf(this);
      if (index !== -1) {
        channels.splice(index, 1);
      }
    }
  }

  static reset(): void {
    this.channels.clear();
  }
}

describe("BroadcastChannel Transport", () => {
  let originalBroadcastChannel: typeof BroadcastChannel | undefined;

  beforeEach(() => {
    // Save original BroadcastChannel
    originalBroadcastChannel = globalThis.BroadcastChannel;

    // Replace with mock
    (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = MockBroadcastChannel;

    // Reset mock state
    MockBroadcastChannel.reset();
  });

  afterEach(() => {
    // Restore original BroadcastChannel
    if (originalBroadcastChannel) {
      (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = originalBroadcastChannel;
    }
    MockBroadcastChannel.reset();
  });

  describe("Initialization", () => {
    it("should create transport with BroadcastChannel", () => {
      const transport = new BroadcastChannelTransport({ channelName: "test-channel" });

      expect(transport.name).toBe("BroadcastChannel");
      expect(transport.isAvailable()).toBe(true);

      transport.close();
    });

    it("should not throw if BroadcastChannel is not available", () => {
      delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;

      const onError = vi.fn();

      expect(() => {
        new BroadcastChannelTransport({ channelName: "test", onError });
      }).not.toThrow();
      expect(onError).toHaveBeenCalled();
      const error = onError.mock.calls[0][0];
      expect(error).toBeInstanceOf(TransportError);
      expect(error.code).toBe(TransportErrorCode.NOT_AVAILABLE);
    });

    it("should accept debug and onError options", () => {
      const onError = vi.fn();
      const transport = new BroadcastChannelTransport({
        channelName: "test",
        debug: true,
        onError,
      });

      expect(transport).toBeDefined();

      transport.close();
    });
  });

  describe("IsAvailable", () => {
    it("should return true when BroadcastChannel exists", () => {
      const transport = new BroadcastChannelTransport({ channelName: "test" });

      expect(transport.isAvailable()).toBe(true);
      transport.close();
    });

    it("should return false when BroadcastChannel does not exist", () => {
      delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;

      const transport = new BroadcastChannelTransport({ channelName: "test" });

      expect(transport.isAvailable()).toBe(false);
    });
  });

  describe("Send", () => {
    it("should send envelope to other tabs", async () => {
      vi.useFakeTimers();

      const transport1 = new BroadcastChannelTransport({ channelName: "test" });
      const transport2 = new BroadcastChannelTransport({ channelName: "test" });

      const received: CrossTabEnvelope[] = [];
      transport2.onMessage((envelope) => received.push(envelope));

      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-1",
        topic: "test.topic",
        payload: { value: 42 },
        timestamp: Date.now(),
        version: 1,
        origin: "http://localhost:3000",
      };

      transport1.send(envelope);

      // Advance timers to trigger async delivery
      await vi.runAllTimersAsync();

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(envelope);

      transport1.close();
      transport2.close();
      vi.useRealTimers();
    });

    it("should not receive own messages (echo prevention)", async () => {
      vi.useFakeTimers();

      const transport = new BroadcastChannelTransport({ channelName: "test" });

      const received: CrossTabEnvelope[] = [];
      transport.onMessage((envelope) => received.push(envelope));

      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-1",
        topic: "test.topic",
        payload: {},
        timestamp: Date.now(),
        version: 1,
        origin: "http://localhost:3000",
      };

      transport.send(envelope);

      await vi.runAllTimersAsync();

      expect(received).toHaveLength(0);

      transport.close();
      vi.useRealTimers();
    });

    it("should not throw when transport is closed", () => {
      const transport = new BroadcastChannelTransport({ channelName: "test" });
      transport.close();

      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-1",
        topic: "test.topic",
        payload: {},
        timestamp: Date.now(),
        version: 1,
        origin: "http://localhost:3000",
      };

      expect(() => transport.send(envelope)).not.toThrow();
    });

    it("should call onError on send failure", () => {
      const onError = vi.fn();
      const transport = new BroadcastChannelTransport({
        channelName: "test",
        onError,
      });

      // Simulate send failure by making postMessage throw
      const mockChannel = (transport as unknown as { channel: MockBroadcastChannel }).channel;
      vi.spyOn(mockChannel, "postMessage").mockImplementation(() => {
        throw new Error("Send failed");
      });

      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-1",
        topic: "test.topic",
        payload: {},
        timestamp: Date.now(),
        version: 1,
        origin: "http://localhost:3000",
      };

      expect(() => transport.send(envelope)).not.toThrow();
      expect(onError).toHaveBeenCalled();

      transport.close();
    });
  });

  describe("onMessage", () => {
    it("should register and invoke message handlers", async () => {
      vi.useFakeTimers();
      const transport1 = new BroadcastChannelTransport({ channelName: "test" });
      const transport2 = new BroadcastChannelTransport({ channelName: "test" });

      const received: CrossTabEnvelope[] = [];
      transport2.onMessage((envelope) => received.push(envelope));

      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-1",
        topic: "test.topic",
        payload: { value: 42 },
        timestamp: Date.now(),
        version: 1,
        origin: "http://localhost:3000",
      };

      transport1.send(envelope);
      await vi.runAllTimersAsync();

      expect(received).toHaveLength(1);

      transport1.close();
      transport2.close();
      vi.useRealTimers();
    });

    it("should support multiple handlers", async () => {
      vi.useFakeTimers();
      const transport1 = new BroadcastChannelTransport({ channelName: "test" });
      const transport2 = new BroadcastChannelTransport({ channelName: "test" });

      const received1: CrossTabEnvelope[] = [];
      const received2: CrossTabEnvelope[] = [];

      transport2.onMessage((envelope) => received1.push(envelope));
      transport2.onMessage((envelope) => received2.push(envelope));

      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-1",
        topic: "test.topic",
        payload: {},
        timestamp: Date.now(),
        version: 1,
        origin: "http://localhost:3000",
      };

      transport1.send(envelope);
      await vi.runAllTimersAsync();

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);

      transport1.close();
      transport2.close();
      vi.useRealTimers();
    });

    it("should return unsubscribe function", async () => {
      vi.useFakeTimers();
      const transport1 = new BroadcastChannelTransport({ channelName: "test" });
      const transport2 = new BroadcastChannelTransport({ channelName: "test" });

      const received: CrossTabEnvelope[] = [];
      const unsubscribe = transport2.onMessage((envelope) => received.push(envelope));

      const envelope: CrossTabEnvelope = {
        messageId: "msg-1",
        clientId: "client-1",
        topic: "test.topic",
        payload: {},
        timestamp: Date.now(),
        version: 1,
        origin: "http://localhost:3000",
      };

      transport1.send(envelope);
      await vi.runAllTimersAsync();
      expect(received).toHaveLength(1);

      unsubscribe();

      transport1.send({ ...envelope, messageId: "msg-2" });
      await vi.runAllTimersAsync();

      expect(received).toHaveLength(1);

      transport1.close();
      transport2.close();
      vi.useRealTimers();
    });

    it("should not throw when registering handler on closed transport", () => {
      const onError = vi.fn();
      const transport = new BroadcastChannelTransport({ channelName: "test", onError });
      transport.close();

      expect(() => {
        transport.onMessage(() => {});
      }).not.toThrow();
      expect(onError).toHaveBeenCalled();
    });

    it("should handle handler errors gracefully", async () => {
      vi.useFakeTimers();
      const onError = vi.fn();
      const transport1 = new BroadcastChannelTransport({ channelName: "test" });
      const transport2 = new BroadcastChannelTransport({ channelName: "test", onError });

      const received: CrossTabEnvelope[] = [];

      transport2.onMessage(() => {
        throw new Error("Handler error");
      });
      transport2.onMessage((envelope) => received.push(envelope));

      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-1",
        topic: "test.topic",
        payload: {},
        timestamp: Date.now(),
        version: 1,
        origin: "http://localhost:3000",
      };

      transport1.send(envelope);
      await vi.runAllTimersAsync();

      expect(received).toHaveLength(1);
      const error = onError.mock.calls[0][0];
      expect(error.code).toBe(TransportErrorCode.RECEIVE_FAILED);
      expect(onError).toHaveBeenCalled();

      transport1.close();
      transport2.close();
      vi.useRealTimers();
    });

    it("should call onError for deserialization errors", async () => {
      vi.useFakeTimers();
      const onError = vi.fn();
      const transport = new BroadcastChannelTransport({
        channelName: "test",
        onError,
      });
      const mockChannel = (transport as unknown as { channel: MockBroadcastChannel }).channel;
      if (mockChannel.onmessage) {
        mockChannel.onmessage(new MessageEvent("message", { data: "invalid json" }));
      }

      await vi.runAllTimersAsync();

      expect(onError).toHaveBeenCalled();
      const error = onError.mock.calls[0][0];
      expect(error.code).toBe(TransportErrorCode.DESERIALIZATION_FAILED);

      transport.close();
      vi.useRealTimers();
    });
  });

  describe("Close", () => {
    it("should close the BroadcastChannel", () => {
      const onError = vi.fn();
      const transport = new BroadcastChannelTransport({ channelName: "test", onError });

      expect(() => transport.close()).not.toThrow();

      // Verify it's closed
      expect(() => {
        transport.send({} as CrossTabEnvelope);
      }).not.toThrow();
      expect(onError).toHaveBeenCalled();
      const error = onError.mock.calls[0][0];
      expect(error.code).toBe(TransportErrorCode.ALREADY_CLOSED);
    });

    it("should clear all handlers", () => {
      const transport = new BroadcastChannelTransport({ channelName: "test" });

      transport.onMessage(() => {});
      transport.onMessage(() => {});

      transport.close();

      // Verify handlers are cleared
      const handlers = (transport as unknown as { handlers: Set<unknown> }).handlers;
      expect(handlers.size).toBe(0);
    });

    it("should be idempotent", () => {
      const transport = new BroadcastChannelTransport({ channelName: "test" });

      transport.close();
      expect(() => transport.close()).not.toThrow();
    });
  });

  describe("CreateBroadcastChannelTransport", () => {
    it("should create transport instance", () => {
      const transport = createBroadcastChannelTransport({ channelName: "test" });

      expect(transport).toBeInstanceOf(BroadcastChannelTransport);
      expect(transport.name).toBe("BroadcastChannel");

      transport.close();
    });
  });

  describe("Multi-tab communication", () => {
    it("should communicate between multiple tabs", async () => {
      vi.useFakeTimers();
      const transport1 = new BroadcastChannelTransport({ channelName: "multi-test" });
      const transport2 = new BroadcastChannelTransport({ channelName: "multi-test" });
      const transport3 = new BroadcastChannelTransport({ channelName: "multi-test" });

      const received2: CrossTabEnvelope[] = [];
      const received3: CrossTabEnvelope[] = [];

      transport2.onMessage((envelope) => received2.push(envelope));
      transport3.onMessage((envelope) => received3.push(envelope));

      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-1",
        topic: "test.topic",
        payload: { data: "broadcast" },
        timestamp: Date.now(),
        version: 1,
        origin: "http://localhost:3000",
      };

      transport1.send(envelope);
      await vi.runAllTimersAsync();

      // Both other tabs should receive
      expect(received2).toHaveLength(1);
      expect(received3).toHaveLength(1);
      expect(received2[0]).toEqual(envelope);
      expect(received3[0]).toEqual(envelope);

      transport1.close();
      transport2.close();
      transport3.close();
      vi.useRealTimers();
    });

    it("should isolate different channels", async () => {
      vi.useFakeTimers();
      const transport1a = new BroadcastChannelTransport({ channelName: "channel-a" });
      const transport1b = new BroadcastChannelTransport({ channelName: "channel-a" });
      const transport2 = new BroadcastChannelTransport({ channelName: "channel-b" });

      const receivedA: CrossTabEnvelope[] = [];
      const receivedB: CrossTabEnvelope[] = [];

      transport1b.onMessage((envelope) => receivedA.push(envelope));
      transport2.onMessage((envelope) => receivedB.push(envelope));

      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-1",
        topic: "test.topic",
        payload: {},
        timestamp: Date.now(),
        version: 1,
        origin: "http://localhost:3000",
      };

      transport1a.send(envelope);
      await vi.runAllTimersAsync();

      // Only channel A should receive
      expect(receivedA).toHaveLength(1);
      expect(receivedB).toHaveLength(0);

      transport1a.close();
      transport1b.close();
      transport2.close();
      vi.useRealTimers();
    });
  });
});
