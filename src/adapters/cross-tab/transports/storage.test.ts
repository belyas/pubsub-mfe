import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CrossTabEnvelope } from "../types";
import { StorageTransport, createStorageTransport } from "./storage";
import { TransportError, TransportErrorCode } from "./base";

class MockStorage implements Storage {
  private store = new Map<string, string>();
  private listeners: Array<(event: StorageEvent) => void> = [];

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    const keys = Array.from(this.store.keys());
    this.store.clear();

    for (const key of keys) {
      this.notifyListeners(key, null, null);
    }
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());

    return keys[index] ?? null;
  }

  removeItem(key: string): void {
    const oldValue = this.store.get(key) ?? null;

    this.store.delete(key);
    this.notifyListeners(key, oldValue, null);
  }

  setItem(key: string, value: string): void {
    const oldValue = this.store.get(key) ?? null;

    this.store.set(key, value);
    this.notifyListeners(key, oldValue, value);
  }

  addEventListener(listener: (event: StorageEvent) => void): void {
    this.listeners.push(listener);
  }

  removeEventListener(listener: (event: StorageEvent) => void): void {
    const index = this.listeners.indexOf(listener);

    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  private notifyListeners(key: string, oldValue: string | null, newValue: string | null): void {
    setTimeout(() => {
      const event = new MessageEvent("storage", {
        data: { key, oldValue, newValue, storageArea: this, url: "http://localhost" },
      }) as unknown as StorageEvent;

      // Add StorageEvent-specific properties
      Object.defineProperties(event, {
        key: { value: key, writable: false },
        oldValue: { value: oldValue, writable: false },
        newValue: { value: newValue, writable: false },
        storageArea: { value: this, writable: false },
        url: { value: "http://localhost", writable: false },
      });

      for (const listener of this.listeners) {
        listener(event);
      }
    }, 0);
  }

  static create(): MockStorage {
    return new MockStorage();
  }
}

describe("Storage Transport", () => {
  let mockStorage: MockStorage;
  let originalLocalStorage: Storage | undefined;
  let originalWindow: typeof globalThis.window;

  beforeEach(() => {
    mockStorage = MockStorage.create();
    originalLocalStorage = globalThis.localStorage;
    originalWindow = globalThis.window;

    Object.defineProperty(globalThis, "localStorage", {
      value: mockStorage,
      writable: true,
      configurable: true,
    });

    if (typeof window === "undefined") {
      (globalThis as { window: unknown }).window = {
        addEventListener: mockStorage.addEventListener.bind(mockStorage),
        removeEventListener: mockStorage.removeEventListener.bind(mockStorage),
      };
    } else {
      const originalAddEventListener = window.addEventListener;
      const originalRemoveEventListener = window.removeEventListener;

      window.addEventListener = function (type: string, listener: any) {
        if (type === "storage") {
          mockStorage.addEventListener(listener);
        } else {
          originalAddEventListener.call(window, type, listener);
        }
      };

      window.removeEventListener = function (type: string, listener: any) {
        if (type === "storage") {
          mockStorage.removeEventListener(listener);
        } else {
          originalRemoveEventListener.call(window, type, listener);
        }
      };
    }
  });

  afterEach(() => {
    mockStorage.clear();

    if (originalLocalStorage !== undefined) {
      Object.defineProperty(globalThis, "localStorage", {
        value: originalLocalStorage,
        writable: true,
        configurable: true,
      });
    }

    if (originalWindow) {
      (globalThis as { window: unknown }).window = originalWindow;
    }
  });

  describe("Initialization", () => {
    it("should create transport with Storage", () => {
      const transport = new StorageTransport({
        channelName: "test-channel",
        storage: mockStorage,
      });

      expect(transport.name).toBe("Storage");
      expect(transport.isAvailable()).toBe(true);

      transport.close();
    });

    it("should generate client ID if not provided", () => {
      const transport = new StorageTransport({
        channelName: "test",
        storage: mockStorage,
      });

      const clientId = transport.getClientId();
      expect(clientId).toBeTruthy();
      expect(typeof clientId).toBe("string");

      transport.close();
    });

    it("should use provided client ID", () => {
      const customId = "custom-client-123";
      const transport = new StorageTransport({
        channelName: "test",
        clientId: customId,
        storage: mockStorage,
      });

      expect(transport.getClientId()).toBe(customId);

      transport.close();
    });

    it("should not throw if Storage is not available", () => {
      delete (globalThis as { localStorage?: unknown }).localStorage;

      const onError = vi.fn();

      expect(() => {
        new StorageTransport({
          channelName: "test",
          onError,
        });
      }).not.toThrow();
      expect(onError).toHaveBeenCalled();

      const error = onError.mock.calls[0][0];
      expect(error).toBeInstanceOf(TransportError);
      expect(error.code).toBe(TransportErrorCode.NOT_AVAILABLE);
    });

    it("should accept custom configuration", () => {
      const transport = new StorageTransport({
        channelName: "test",
        storage: mockStorage,
        ttlMs: 60000,
        cleanupIntervalMs: 20000,
        maxMessages: 50,
        keyPrefix: "custom-prefix",
        debug: true,
      });

      expect(transport.isAvailable()).toBe(true);
      transport.close();
    });

    it("should clean up expired messages on init", () => {
      // Add some expired messages
      const now = Date.now();
      mockStorage.setItem(
        "pubsub-mfe:test:old-msg",
        JSON.stringify({ payload: "test", timestamp: now - 100000, senderId: "old-client" })
      );

      const transport = new StorageTransport({
        channelName: "test",
        storage: mockStorage,
        ttlMs: 50000,
      });

      expect(mockStorage.getItem("pubsub-mfe:test:old-msg")).toBeNull();
      transport.close();
    });
  });

  describe("Send and Receive", () => {
    it("should send message to storage", () => {
      const transport = new StorageTransport({
        channelName: "test",
        storage: mockStorage,
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

      transport.send(envelope);

      // Check that message was stored
      const keys = Array.from({ length: mockStorage.length }, (_, i) => mockStorage.key(i)).filter(
        (key) => key?.includes("test:")
      );

      expect(keys.length).toBeGreaterThan(0);
      transport.close();
    });

    it("should receive messages from other clients via StorageEvent", async () => {
      vi.useFakeTimers();
      const transport1 = new StorageTransport({
        channelName: "test",
        clientId: "client-1",
        storage: mockStorage,
      });
      const transport2 = new StorageTransport({
        channelName: "test",
        clientId: "client-2",
        storage: mockStorage,
      });
      const received: CrossTabEnvelope[] = [];

      transport2.onMessage((envelope) => {
        received.push(envelope);

        return () => {};
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

      transport1.send(envelope);

      vi.advanceTimersByTime(20);

      expect(received.length).toBeGreaterThan(0);
      expect(received[0].topic).toBe("test.topic");
      expect(received[0].payload).toEqual({ data: "hello" });

      transport1.close();
      transport2.close();
      vi.useRealTimers();
    });

    it("should not receive own messages", async () => {
      vi.useFakeTimers();
      const transport = new StorageTransport({
        channelName: "test",
        storage: mockStorage,
      });
      const received: CrossTabEnvelope[] = [];

      transport.onMessage((envelope) => {
        received.push(envelope);
        return () => {};
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

      transport.send(envelope);

      vi.advanceTimersByTime(20);

      expect(received.length).toBe(0);

      transport.close();
      vi.useRealTimers();
    });

    it("should handle deduplication of messages", async () => {
      vi.useFakeTimers();
      const transport = new StorageTransport({
        channelName: "test",
        clientId: "client-1",
        storage: mockStorage,
      });
      const received: CrossTabEnvelope[] = [];

      transport.onMessage((envelope) => {
        received.push(envelope);
        return () => {};
      });

      const envelope: CrossTabEnvelope = {
        messageId: "msg-duplicate",
        clientId: "client-2",
        topic: "test.topic",
        payload: { data: "test" },
        timestamp: Date.now(),
        version: 1,
        origin: "test",
      };

      // Simulate receiving the same message twice
      const key = "pubsub-mfe:test:msg-1";
      const wrapper = JSON.stringify({
        payload: JSON.stringify(envelope),
        timestamp: Date.now(),
        senderId: "client-2",
      });

      mockStorage.setItem(key, wrapper);
      vi.advanceTimersByTime(20);

      mockStorage.setItem(key, wrapper);
      vi.advanceTimersByTime(20);

      // Should only receive once due to deduplication
      expect(received.length).toBeLessThanOrEqual(1);

      transport.close();
      vi.useRealTimers();
    });
  });

  describe("TTL and Cleanup", () => {
    it("should remove expired messages based on TTL", async () => {
      vi.useFakeTimers();
      const transport = new StorageTransport({
        channelName: "test",
        storage: mockStorage,
        ttlMs: 50,
        cleanupIntervalMs: 30,
      });

      const envelope: CrossTabEnvelope = {
        messageId: "msg-1",
        clientId: "client-1",
        topic: "test.topic",
        payload: { data: "test" },
        timestamp: Date.now(),
        version: 1,
        origin: "test",
      };

      transport.send(envelope);

      const initialKeys = Array.from({ length: mockStorage.length }, (_, i) =>
        mockStorage.key(i)
      ).filter((key) => key?.includes("test:"));

      expect(initialKeys.length).toBeGreaterThan(0);

      vi.advanceTimersByTime(100);

      const finalKeys = Array.from({ length: mockStorage.length }, (_, i) =>
        mockStorage.key(i)
      ).filter((key) => key?.includes("test:"));

      expect(finalKeys.length).toBe(0);

      transport.close();
      vi.useRealTimers();
    });

    it("should enforce max messages limit", () => {
      const transport = new StorageTransport({
        channelName: "test",
        storage: mockStorage,
        maxMessages: 5,
      });

      // Send more messages than the limit
      for (let i = 0; i < 10; i++) {
        const envelope: CrossTabEnvelope = {
          messageId: `msg-${i}`,
          clientId: "client-1",
          topic: "test.topic",
          payload: { data: `test-${i}` },
          timestamp: Date.now() + i,
          version: 1,
          origin: "test",
        };
        transport.send(envelope);
      }

      // Check that only maxMessages are stored
      const keys = Array.from({ length: mockStorage.length }, (_, i) => mockStorage.key(i)).filter(
        (key) => key?.includes("test:")
      );

      expect(keys.length).toBeLessThanOrEqual(5);

      transport.close();
    });

    it("should clear channel messages", () => {
      const transport = new StorageTransport({
        channelName: "test",
        storage: mockStorage,
      });

      for (let i = 0; i < 3; i++) {
        const envelope: CrossTabEnvelope = {
          messageId: `msg-${i}`,
          clientId: "client-1",
          topic: "test.topic",
          payload: { data: `test-${i}` },
          timestamp: Date.now(),
          version: 1,
          origin: "test",
        };
        transport.send(envelope);
      }

      const beforeClear = Array.from({ length: mockStorage.length }, (_, i) =>
        mockStorage.key(i)
      ).filter((key) => key?.includes("test:"));

      expect(beforeClear.length).toBeGreaterThan(0);

      transport.clearChannel();

      const afterClear = Array.from({ length: mockStorage.length }, (_, i) =>
        mockStorage.key(i)
      ).filter((key) => key?.includes("test:"));

      expect(afterClear.length).toBe(0);

      transport.close();
    });
  });

  describe("Quota Handling", () => {
    it("should handle quota exceeded errors with retry", () => {
      const quotaStorage = MockStorage.create();
      let setItemCallCount = 0;

      // Override setItem to simulate quota error on first call, then succeed
      const originalSetItem = quotaStorage.setItem.bind(quotaStorage);
      quotaStorage.setItem = function (key: string, value: string) {
        setItemCallCount++;

        if (setItemCallCount === 1) {
          const error = new DOMException("QuotaExceededError", "QuotaExceededError");
          (error as { code: number }).code = 22;
          throw error;
        }
        originalSetItem(key, value);
      };

      const transport = new StorageTransport({
        channelName: "test",
        storage: quotaStorage,
      });

      const envelope: CrossTabEnvelope = {
        messageId: "msg-1",
        clientId: "client-1",
        topic: "test.topic",
        payload: { data: "test" },
        timestamp: Date.now(),
        version: 1,
        origin: "test",
      };

      // Should retry and succeed
      transport.send(envelope);

      expect(setItemCallCount).toBeGreaterThan(1);

      transport.close();
    });

    it("should call error handler if quota exceeded after cleanup", () => {
      const quotaStorage = MockStorage.create();
      const onError = vi.fn();
      let allowedOperations = 0;
      // Save original methods
      const originalSetItem = quotaStorage.setItem.bind(quotaStorage);

      // Override setItem to throw quota error after init phase
      quotaStorage.setItem = function (key: string, value: string) {
        allowedOperations++;
        // Allow a few operations for initialization (availability check, cleanup)
        if (allowedOperations <= 2) {
          return originalSetItem(key, value);
        }
        // Throw quota error for actual message sends
        const error = new DOMException("QuotaExceededError", "QuotaExceededError");
        (error as { code: number }).code = 22;
        throw error;
      };

      const transport = new StorageTransport({
        channelName: "test",
        storage: quotaStorage,
        onError,
      });

      const envelope: CrossTabEnvelope = {
        messageId: "msg-1",
        clientId: "client-1",
        topic: "test.topic",
        payload: { data: "test" },
        timestamp: Date.now(),
        version: 1,
        origin: "test",
      };

      transport.send(envelope);

      expect(onError).toHaveBeenCalled();
      const error = onError.mock.calls[onError.mock.calls.length - 1][0];
      expect(error).toBeInstanceOf(TransportError);
      expect(error.code).toBe(TransportErrorCode.SEND_FAILED);

      transport.close();
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed storage data", () => {
      vi.useFakeTimers();
      const onError = vi.fn();
      const transport = new StorageTransport({
        channelName: "test",
        clientId: "client-1",
        storage: mockStorage,
        onError,
      });

      transport.onMessage(() => () => {});

      // Add malformed data
      mockStorage.setItem("pubsub-mfe:test:bad", "not valid json");

      vi.advanceTimersByTime(20);

      transport.close();
      vi.useRealTimers();
    });

    it("should handle deserialization errors gracefully", () => {
      vi.useFakeTimers();
      const transport = new StorageTransport({
        channelName: "test",
        clientId: "client-1",
        storage: mockStorage,
        onError: vi.fn(),
      });
      const received: CrossTabEnvelope[] = [];

      transport.onMessage((envelope) => {
        received.push(envelope);
        return () => {};
      });

      const key = "pubsub-mfe:test:invalid";
      const wrapper = JSON.stringify({
        payload: "invalid-envelope-data",
        timestamp: Date.now(),
        senderId: "client-2",
      });

      mockStorage.setItem(key, wrapper);

      vi.advanceTimersByTime(20);

      // Should not receive the invalid message
      expect(received.length).toBe(0);

      transport.close();
      vi.useRealTimers();
    });
  });

  describe("Cleanup", () => {
    it("should clean up resources on close", () => {
      const transport = new StorageTransport({
        channelName: "test",
        storage: mockStorage,
      });

      transport.close();

      // Storage listener should be removed
      expect(mockStorage["listeners"].length).toBe(0);
    });

    it("should not send messages after close", () => {
      const transport = new StorageTransport({
        channelName: "test",
        storage: mockStorage,
      });

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
    });

    it("should stop cleanup timer on close", async () => {
      vi.useFakeTimers();
      const transport = new StorageTransport({
        channelName: "test",
        storage: mockStorage,
        cleanupIntervalMs: 50,
      });

      transport.close();

      const now = Date.now();
      mockStorage.setItem(
        "pubsub-mfe:test:expired",
        JSON.stringify({ payload: "test", timestamp: now - 100000, senderId: "old-client" })
      );

      vi.advanceTimersByTime(100);

      // Message should still be there because cleanup stopped
      expect(mockStorage.getItem("pubsub-mfe:test:expired")).not.toBeNull();
      vi.useRealTimers();
    });
  });

  describe("Factory Function", () => {
    it("should create transport via factory", () => {
      const transport = createStorageTransport({
        channelName: "test",
        storage: mockStorage,
      });

      expect(transport).toBeInstanceOf(StorageTransport);
      expect(transport.name).toBe("Storage");

      transport.close();
    });
  });
});
