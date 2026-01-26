import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createAutoTransport,
  createTransport,
  getBestAvailableTransport,
  getAvailableTransports,
  isSharedWorkerAvailable,
  isBroadcastChannelAvailable,
  isStorageAvailable,
} from "./auto";

describe("Auto Transport", () => {
  let originalSharedWorker: typeof SharedWorker | undefined;
  let originalBroadcastChannel: typeof BroadcastChannel | undefined;
  let originalLocalStorage: Storage | undefined;
  let originalWindow: typeof globalThis.window;

  beforeEach(() => {
    originalSharedWorker = globalThis.SharedWorker;
    originalBroadcastChannel = globalThis.BroadcastChannel;
    originalLocalStorage = globalThis.localStorage;
    originalWindow = globalThis.window;

    // Reset to defaults - all available
    (globalThis as { SharedWorker: unknown }).SharedWorker = class MockSharedWorker {
      port = { postMessage: vi.fn(), start: vi.fn(), close: vi.fn() };
    };
    (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = class MockBroadcastChannel {
      postMessage = vi.fn();
      close = vi.fn();
    };
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        setItem: vi.fn(),
        getItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      },
      writable: true,
      configurable: true,
    });

    if (typeof window === "undefined") {
      (globalThis as { window: unknown }).window = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
    }
  });

  afterEach(() => {
    if (originalSharedWorker !== undefined) {
      (globalThis as { SharedWorker: unknown }).SharedWorker = originalSharedWorker;
    } else {
      delete (globalThis as { SharedWorker?: unknown }).SharedWorker;
    }

    if (originalBroadcastChannel !== undefined) {
      (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = originalBroadcastChannel;
    } else {
      delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    }

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

  describe("Availability Checks", () => {
    it("should detect SharedWorker availability", () => {
      expect(isSharedWorkerAvailable()).toBe(true);

      delete (globalThis as { SharedWorker?: unknown }).SharedWorker;
      expect(isSharedWorkerAvailable()).toBe(false);
    });

    it("should detect BroadcastChannel availability", () => {
      expect(isBroadcastChannelAvailable()).toBe(true);

      delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
      expect(isBroadcastChannelAvailable()).toBe(false);
    });

    it("should detect Storage availability", () => {
      expect(isStorageAvailable()).toBe(true);

      delete (globalThis as { localStorage?: unknown }).localStorage;
      expect(isStorageAvailable()).toBe(false);
    });

    it("should return all available transports", () => {
      const available = getAvailableTransports();

      expect(available).toEqual({
        sharedworker: true,
        "broadcast-channel": true,
        storage: true,
      });

      delete (globalThis as { SharedWorker?: unknown }).SharedWorker;
      const availableWithoutWorker = getAvailableTransports();

      expect(availableWithoutWorker).toEqual({
        sharedworker: false,
        "broadcast-channel": true,
        storage: true,
      });
    });
  });

  describe("GetBestAvailableTransport", () => {
    it("should return SharedWorker as best when all available", () => {
      const best = getBestAvailableTransport();
      expect(best).toBe("sharedworker");
    });

    it("should fall back to BroadcastChannel when SharedWorker unavailable", () => {
      delete (globalThis as { SharedWorker?: unknown }).SharedWorker;

      const best = getBestAvailableTransport();

      expect(best).toBe("broadcast-channel");
    });

    it("should fall back to Storage when both SharedWorker and BroadcastChannel unavailable", () => {
      delete (globalThis as { SharedWorker?: unknown }).SharedWorker;
      delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;

      const best = getBestAvailableTransport();

      expect(best).toBe("storage");
    });

    it("should return null when no transport available", () => {
      delete (globalThis as { SharedWorker?: unknown }).SharedWorker;
      delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
      delete (globalThis as { localStorage?: unknown }).localStorage;

      const best = getBestAvailableTransport();

      expect(best).toBeNull();
    });

    it("should respect preferred transport", () => {
      const best = getBestAvailableTransport("storage");

      expect(best).toBe("storage");
    });

    it("should fall back from preferred if unavailable", () => {
      delete (globalThis as { SharedWorker?: unknown }).SharedWorker;

      const best = getBestAvailableTransport("sharedworker");

      expect(best).toBe("broadcast-channel");
    });
  });

  describe("CreateAutoTransport", () => {
    it("should create SharedWorker transport by default", () => {
      const result = createAutoTransport({ channelName: "test" });

      expect(result.transport).toBeDefined();
      expect(result.type).toBe("sharedworker");
      expect(result.transport.name).toBe("SharedWorker");
      expect(result.fallbackChain).toContain("sharedworker");

      result.transport.close();
    });

    it("should fall back to BroadcastChannel when SharedWorker unavailable", () => {
      delete (globalThis as { SharedWorker?: unknown }).SharedWorker;

      const result = createAutoTransport({ channelName: "test" });

      expect(result.transport).toBeDefined();
      expect(result.type).toBe("broadcast-channel");
      expect(result.transport.name).toBe("BroadcastChannel");
      expect(result.fallbackChain).toContain("broadcast-channel");

      result.transport.close();
    });

    it("should fall back to Storage when SharedWorker and BroadcastChannel unavailable", () => {
      delete (globalThis as { SharedWorker?: unknown }).SharedWorker;
      delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;

      const result = createAutoTransport({ channelName: "test" });

      expect(result.transport).toBeDefined();
      expect(result.type).toBe("storage");
      expect(result.transport.name).toBe("Storage");
      expect(result.fallbackChain).toContain("storage");

      result.transport.close();
    });

    it("should throw error when no transport available", () => {
      delete (globalThis as { SharedWorker?: unknown }).SharedWorker;
      delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
      delete (globalThis as { localStorage?: unknown }).localStorage;

      expect(() => {
        createAutoTransport({ channelName: "test" });
      }).toThrow(/No transport available/);
    });

    it("should respect preferredMode option", () => {
      const result = createAutoTransport({
        channelName: "test",
        preferredMode: "storage",
      });

      expect(result.type).toBe("storage");
      expect(result.transport.name).toBe("Storage");

      result.transport.close();
    });

    it("should not call onFallback when first successful transport", () => {
      delete (globalThis as { SharedWorker?: unknown }).SharedWorker;

      const onFallback = vi.fn();
      const result = createAutoTransport({
        channelName: "test",
        onFallback,
      });

      expect(result.type).toBe("broadcast-channel");
      // onFallback should not be called on the first successful transport
      expect(onFallback).not.toHaveBeenCalled();

      result.transport.close();
    });

    it("should provide custom configuration to transports", () => {
      const result = createAutoTransport({
        channelName: "custom-channel",
        clientId: "custom-client",
        sharedWorkerUrl: "https://example.com/worker.js",
        debug: true,
      });

      expect(result.transport).toBeDefined();
      result.transport.close();
    });

    it("should include fallback chain in result", () => {
      const result = createAutoTransport({ channelName: "test" });

      expect(result.fallbackChain).toBeInstanceOf(Array);
      expect(result.fallbackChain.length).toBeGreaterThan(0);
      expect(result.fallbackChain).toContain(result.type);

      result.transport.close();
    });
  });

  describe("CreateTransport", () => {
    it("should create specific transport type", () => {
      const transport = createTransport("broadcast-channel", {
        channelName: "test",
      });

      expect(transport).toBeDefined();
      expect(transport.name).toBe("BroadcastChannel");

      transport.close();
    });

    it("should throw error if requested transport unavailable", () => {
      delete (globalThis as { SharedWorker?: unknown }).SharedWorker;

      expect(() => {
        createTransport("sharedworker", { channelName: "test" });
      }).toThrow(/not available/);
    });

    it("should create SharedWorker transport", () => {
      const transport = createTransport("sharedworker", {
        channelName: "test",
      });

      expect(transport.name).toBe("SharedWorker");
      transport.close();
    });

    it("should create Storage transport", () => {
      const transport = createTransport("storage", {
        channelName: "test",
      });

      expect(transport.name).toBe("Storage");
      transport.close();
    });

    it("should pass configuration to transport", () => {
      const transport = createTransport("storage", {
        channelName: "test-channel",
        clientId: "test-client",
        storageTtlMs: 60000,
        storageMaxMessages: 50,
      });

      expect(transport).toBeDefined();
      transport.close();
    });
  });

  describe("Fallback Chain Logic", () => {
    it("should try all transports in order", () => {
      delete (globalThis as { SharedWorker?: unknown }).SharedWorker;
      delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;

      const result = createAutoTransport({ channelName: "test" });

      expect(result.type).toBe("storage");
      expect(result.fallbackChain).toEqual(["sharedworker", "broadcast-channel", "storage"]);

      result.transport.close();
    });

    it("should use custom preferred mode first", () => {
      const result = createAutoTransport({
        channelName: "test",
        preferredMode: "broadcast-channel",
      });

      expect(result.type).toBe("broadcast-channel");
      expect(result.fallbackChain[0]).toBe("broadcast-channel");

      result.transport.close();
    });

    it("should handle errors during transport creation", () => {
      delete (globalThis as { SharedWorker?: unknown }).SharedWorker;

      const onFallback = vi.fn();
      const result = createAutoTransport({
        channelName: "test",
        onFallback,
      });

      // Should fall back to BroadcastChannel
      expect(result.type).toBe("broadcast-channel");
      // onFallback is not called because SharedWorker was never tried (not available)
      expect(onFallback).not.toHaveBeenCalled();

      result.transport.close();
    });
  });

  describe("Error Handling", () => {
    it("should provide meaningful error when all transports fail", () => {
      delete (globalThis as { SharedWorker?: unknown }).SharedWorker;
      delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
      delete (globalThis as { localStorage?: unknown }).localStorage;

      expect(() => {
        createAutoTransport({ channelName: "test" });
      }).toThrow(/No transport available/);
    });

    it("should include fallback chain in error message", () => {
      delete (globalThis as { SharedWorker?: unknown }).SharedWorker;
      delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
      delete (globalThis as { localStorage?: unknown }).localStorage;

      try {
        createAutoTransport({ channelName: "test" });
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as Error).message).toContain("sharedworker");
        expect((error as Error).message).toContain("broadcast-channel");
        expect((error as Error).message).toContain("storage");
      }
    });

    it("should handle onError callback from transports", () => {
      const onError = vi.fn();
      const result = createAutoTransport({
        channelName: "test",
        onError,
      });

      expect(result.transport).toBeDefined();
      result.transport.close();
    });
  });
});
