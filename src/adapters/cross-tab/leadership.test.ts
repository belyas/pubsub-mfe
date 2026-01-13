import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LeadershipDetector, createLeadershipDetector } from "./leadership";

describe("Leadership Detection", () => {
  let mockVisibilityState: "visible" | "hidden";
  let visibilityChangeListeners: Array<() => void>;

  beforeEach(() => {
    mockVisibilityState = "visible";
    visibilityChangeListeners = [];

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get() {
        return mockVisibilityState;
      },
    });

    const originalAddEventListener = document.addEventListener;
    const originalRemoveEventListener = document.removeEventListener;

    vi.spyOn(document, "addEventListener").mockImplementation((event, listener) => {
      if (event === "visibilitychange") {
        visibilityChangeListeners.push(listener as () => void);
      } else {
        originalAddEventListener.call(document, event, listener as EventListener);
      }
    });

    vi.spyOn(document, "removeEventListener").mockImplementation((event, listener) => {
      if (event === "visibilitychange") {
        const index = visibilityChangeListeners.indexOf(listener as () => void);
        if (index > -1) {
          visibilityChangeListeners.splice(index, 1);
        }
      } else {
        originalRemoveEventListener.call(document, event, listener as EventListener);
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    visibilityChangeListeners = [];
  });

  const triggerVisibilityChange = () => {
    visibilityChangeListeners.forEach((listener) => listener());
  };

  describe("LeadershipDetector constructor", () => {
    it("should create detector with clientId", () => {
      const detector = new LeadershipDetector({ clientId: "client-1" });

      expect(detector).toBeDefined();
      expect(detector.getState().clientId).toBe("client-1");

      detector.stop();
    });

    it("should start automatically", () => {
      mockVisibilityState = "visible";
      const detector = new LeadershipDetector({ clientId: "client-1" });

      expect(detector.isLeader()).toBe(true);

      detector.stop();
    });

    it("should register visibilitychange listener", () => {
      const detector = new LeadershipDetector({ clientId: "client-1" });

      expect(document.addEventListener).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function)
      );

      detector.stop();
    });

    it("should accept onLeadershipChange callback", () => {
      const onLeadershipChange = vi.fn();
      const detector = new LeadershipDetector({
        clientId: "client-1",
        onLeadershipChange,
      });

      // Should not call immediately (state hasn't changed)
      expect(onLeadershipChange).not.toHaveBeenCalled();

      detector.stop();
    });

    it("should accept debug flag", () => {
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
      const detector = new LeadershipDetector({
        clientId: "client-1",
        debug: true,
      });

      expect(consoleLog).toHaveBeenCalledWith(
        "[Leadership] Started",
        expect.objectContaining({
          clientId: "client-1",
        })
      );

      detector.stop();
      consoleLog.mockRestore();
    });
  });

  describe("IsLeader", () => {
    it("should return true when tab is visible", () => {
      mockVisibilityState = "visible";
      const detector = new LeadershipDetector({ clientId: "client-1" });

      expect(detector.isLeader()).toBe(true);

      detector.stop();
    });

    it("should return false when tab is hidden", () => {
      mockVisibilityState = "hidden";
      const detector = new LeadershipDetector({ clientId: "client-1" });

      expect(detector.isLeader()).toBe(false);

      detector.stop();
    });

    it("should update when visibility changes", () => {
      mockVisibilityState = "visible";
      const detector = new LeadershipDetector({ clientId: "client-1" });

      expect(detector.isLeader()).toBe(true);

      mockVisibilityState = "hidden";
      triggerVisibilityChange();

      expect(detector.isLeader()).toBe(false);

      mockVisibilityState = "visible";
      triggerVisibilityChange();

      expect(detector.isLeader()).toBe(true);

      detector.stop();
    });
  });

  describe("GetState", () => {
    it("should return leadership state", () => {
      mockVisibilityState = "visible";
      const detector = new LeadershipDetector({ clientId: "client-1" });

      const state = detector.getState();

      expect(state).toEqual({
        isLeader: true,
        clientId: "client-1",
        lastUpdate: expect.any(Number),
      });

      detector.stop();
    });

    it("should update lastUpdate timestamp", () => {
      const detector = new LeadershipDetector({ clientId: "client-1" });

      const state1 = detector.getState();
      const state2 = detector.getState();

      expect(state2.lastUpdate).toBeGreaterThanOrEqual(state1.lastUpdate);

      detector.stop();
    });
  });

  describe("OnLeadershipChange callback", () => {
    it("should call callback when leadership changes", () => {
      mockVisibilityState = "visible";
      const onLeadershipChange = vi.fn();
      const detector = new LeadershipDetector({
        clientId: "client-1",
        onLeadershipChange,
      });

      mockVisibilityState = "hidden";
      triggerVisibilityChange();

      expect(onLeadershipChange).toHaveBeenCalledWith(false);

      mockVisibilityState = "visible";
      triggerVisibilityChange();

      expect(onLeadershipChange).toHaveBeenCalledWith(true);
      expect(onLeadershipChange).toHaveBeenCalledTimes(2);

      detector.stop();
    });

    it("should not call callback if leadership does not change", () => {
      mockVisibilityState = "visible";
      const onLeadershipChange = vi.fn();
      const detector = new LeadershipDetector({
        clientId: "client-1",
        onLeadershipChange,
      });

      triggerVisibilityChange();

      expect(onLeadershipChange).not.toHaveBeenCalled();

      detector.stop();
    });

    it("should handle callback errors gracefully", () => {
      mockVisibilityState = "visible";
      const onLeadershipChange = vi.fn(() => {
        throw new Error("Callback error");
      });
      const detector = new LeadershipDetector({
        clientId: "client-1",
        onLeadershipChange,
        debug: true,
      });

      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      mockVisibilityState = "hidden";

      expect(() => triggerVisibilityChange()).not.toThrow();
      expect(consoleError).toHaveBeenCalledWith(
        "[Leadership] Error in callback",
        expect.any(Error)
      );

      detector.stop();
      consoleError.mockRestore();
    });
  });

  describe("Start", () => {
    it("should be idempotent", () => {
      const detector = new LeadershipDetector({ clientId: "client-1" });

      const listenerCount = visibilityChangeListeners.length;

      detector.start();
      detector.start();

      // Should not add duplicate listeners
      expect(visibilityChangeListeners.length).toBe(listenerCount);

      detector.stop();
    });

    it("should perform initial leadership check", () => {
      mockVisibilityState = "hidden";
      const detector = new LeadershipDetector({ clientId: "client-1" });

      expect(detector.isLeader()).toBe(false);

      detector.stop();
    });
  });

  describe("stop", () => {
    it("should remove visibilitychange listener", () => {
      const detector = new LeadershipDetector({ clientId: "client-1" });

      detector.stop();

      expect(document.removeEventListener).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function)
      );
    });

    it("should be idempotent", () => {
      const detector = new LeadershipDetector({ clientId: "client-1" });

      expect(() => {
        detector.stop();
        detector.stop();
      }).not.toThrow();
    });

    it("should not trigger callbacks after stop", () => {
      mockVisibilityState = "visible";
      const onLeadershipChange = vi.fn();
      const detector = new LeadershipDetector({
        clientId: "client-1",
        onLeadershipChange,
      });

      detector.stop();

      mockVisibilityState = "hidden";
      triggerVisibilityChange();

      expect(onLeadershipChange).not.toHaveBeenCalled();
    });

    it("should log when debug is enabled", () => {
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
      const detector = new LeadershipDetector({
        clientId: "client-1",
        debug: true,
      });

      detector.stop();

      expect(consoleLog).toHaveBeenCalledWith(
        "[Leadership] Stopped",
        expect.objectContaining({ clientId: "client-1" })
      );

      consoleLog.mockRestore();
    });
  });

  describe("Refresh", () => {
    it("should check leadership state", () => {
      mockVisibilityState = "visible";
      const detector = new LeadershipDetector({ clientId: "client-1" });

      expect(detector.isLeader()).toBe(true);

      mockVisibilityState = "hidden";
      // Refresh should detect the change
      const changed = detector.refresh();

      expect(changed).toBe(true);
      expect(detector.isLeader()).toBe(false);

      detector.stop();
    });

    it("should return false if state has not changed", () => {
      mockVisibilityState = "visible";
      const detector = new LeadershipDetector({ clientId: "client-1" });

      const changed = detector.refresh();

      expect(changed).toBe(false);

      detector.stop();
    });

    it("should trigger callback if state changed", () => {
      mockVisibilityState = "visible";
      const onLeadershipChange = vi.fn();
      const detector = new LeadershipDetector({
        clientId: "client-1",
        onLeadershipChange,
      });

      mockVisibilityState = "hidden";
      detector.refresh();

      expect(onLeadershipChange).toHaveBeenCalledWith(false);

      detector.stop();
    });
  });

  describe("CreateLeadershipDetector factory", () => {
    it("should create detector instance", () => {
      const detector = createLeadershipDetector({ clientId: "client-1" });

      expect(detector).toBeInstanceOf(LeadershipDetector);

      detector.stop();
    });

    it("should accept configuration", () => {
      const onLeadershipChange = vi.fn();
      const detector = createLeadershipDetector({
        clientId: "client-1",
        onLeadershipChange,
        debug: true,
      });

      expect(detector.getState().clientId).toBe("client-1");

      detector.stop();
    });
  });

  describe("Integration scenarios", () => {
    it("should handle tab going to background and returning", () => {
      mockVisibilityState = "visible";
      const onLeadershipChange = vi.fn();
      const detector = new LeadershipDetector({
        clientId: "client-1",
        onLeadershipChange,
      });

      expect(detector.isLeader()).toBe(true);

      // User switches to another tab
      mockVisibilityState = "hidden";
      triggerVisibilityChange();

      expect(detector.isLeader()).toBe(false);
      expect(onLeadershipChange).toHaveBeenCalledWith(false);

      // User switches back
      mockVisibilityState = "visible";
      triggerVisibilityChange();

      expect(detector.isLeader()).toBe(true);
      expect(onLeadershipChange).toHaveBeenCalledWith(true);
      expect(onLeadershipChange).toHaveBeenCalledTimes(2);

      detector.stop();
    });

    it("should handle rapid visibility changes", () => {
      mockVisibilityState = "visible";
      const onLeadershipChange = vi.fn();
      const detector = new LeadershipDetector({
        clientId: "client-1",
        onLeadershipChange,
      });

      // Rapid changes
      for (let i = 0; i < 10; i++) {
        mockVisibilityState = i % 2 === 0 ? "hidden" : "visible";
        triggerVisibilityChange();
      }

      // Should have called callback 10 times (each change)
      expect(onLeadershipChange).toHaveBeenCalledTimes(10);

      detector.stop();
    });

    it("should coordinate with WebSocket connection", () => {
      mockVisibilityState = "visible";
      let wsConnected = false;

      const detector = new LeadershipDetector({
        clientId: "client-1",
        onLeadershipChange: (isLeader) => {
          if (isLeader) {
            wsConnected = true; // Connect WebSocket
          } else {
            wsConnected = false; // Disconnect WebSocket
          }
        },
      });

      expect(wsConnected).toBe(false); // Not connected initially (no change event)

      // Become leader (simulate initial visible->hidden->visible sequence)
      mockVisibilityState = "hidden";
      triggerVisibilityChange();
      expect(wsConnected).toBe(false);

      mockVisibilityState = "visible";
      triggerVisibilityChange();
      expect(wsConnected).toBe(true);

      // Lose leadership
      mockVisibilityState = "hidden";
      triggerVisibilityChange();
      expect(wsConnected).toBe(false);

      detector.stop();
    });

    it("should support multiple detectors with different clientIds", () => {
      mockVisibilityState = "visible";

      const detector1 = new LeadershipDetector({ clientId: "client-1" });
      const detector2 = new LeadershipDetector({ clientId: "client-2" });

      // Both should be leaders (both visible)
      expect(detector1.isLeader()).toBe(true);
      expect(detector2.isLeader()).toBe(true);

      detector1.stop();
      detector2.stop();
    });

    it("should handle page lifecycle", () => {
      mockVisibilityState = "visible";
      const onLeadershipChange = vi.fn();

      const detector = new LeadershipDetector({
        clientId: "client-1",
        onLeadershipChange,
      });

      // Page hidden (user switches away)
      mockVisibilityState = "hidden";
      triggerVisibilityChange();

      // Page frozen (browser suspends tab)
      // ... no event for this, but tab remains hidden

      // Page resumed (browser restores tab)
      // ... no event for this either

      // Page visible again (user switches back)
      mockVisibilityState = "visible";
      triggerVisibilityChange();

      expect(onLeadershipChange).toHaveBeenCalledTimes(2);
      expect(detector.isLeader()).toBe(true);

      detector.stop();
    });
  });

  describe("Debug logging", () => {
    it("should log visibility changes when debug is enabled", () => {
      mockVisibilityState = "visible";
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
      const detector = new LeadershipDetector({
        clientId: "client-1",
        debug: true,
      });

      mockVisibilityState = "hidden";
      triggerVisibilityChange();

      expect(consoleLog).toHaveBeenCalledWith(
        "[Leadership] Visibility changed",
        expect.any(Object)
      );

      detector.stop();
      consoleLog.mockRestore();
    });

    it("should log state changes when debug is enabled", () => {
      mockVisibilityState = "visible";
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
      const detector = new LeadershipDetector({
        clientId: "client-1",
        debug: true,
      });

      mockVisibilityState = "hidden";
      triggerVisibilityChange();

      expect(consoleLog).toHaveBeenCalledWith(
        "[Leadership] State changed",
        expect.objectContaining({
          clientId: "client-1",
          wasLeader: true,
          isLeader: false,
        })
      );

      detector.stop();
      consoleLog.mockRestore();
    });

    it("should not log when debug is disabled", () => {
      mockVisibilityState = "visible";
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
      const detector = new LeadershipDetector({
        clientId: "client-1",
        debug: false,
      });

      mockVisibilityState = "hidden";
      triggerVisibilityChange();

      // Should not have debug logs (only internal browser logs if any)
      const debugCalls = consoleLog.mock.calls.filter((call) =>
        call[0]?.toString().includes("[Leadership]")
      );
      expect(debugCalls).toHaveLength(0);

      detector.stop();
      consoleLog.mockRestore();
    });
  });
});
