import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPubSub, __resetForTesting } from "./bus";
import type { DiagnosticEvent, Message, PubSubBus } from "./types";

/**
 * Flush pending microtasks to allow async dispatch to complete.
 */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => window.queueMicrotask(resolve));
}

describe("PubSubBus", () => {
  let bus: PubSubBus;

  beforeEach(() => {
    __resetForTesting();
    bus = createPubSub({ app: "test" });
  });

  afterEach(() => {
    bus.dispose();
  });

  describe("Basic pub/sub", () => {
    it("should subscribe and receive messages", async () => {
      const received: Message[] = [];

      bus.subscribe("cart.item.add", (msg) => {
        received.push(msg);
      });

      bus.publish("cart.item.add", { sku: "ABC123", qty: 1 });

      // Wait for async dispatch
      await flushMicrotasks();

      expect(received).toHaveLength(1);
      expect(received[0].topic).toBe("cart.item.add");
      expect(received[0].payload).toEqual({ sku: "ABC123", qty: 1 });
    });

    it("should return message envelope on publish", () => {
      const message = bus.publish("cart.item.add", { sku: "ABC123" });

      expect(message.id).toEqual(expect.any(String));
      expect(message.topic).toBe("cart.item.add");
      expect(message.ts).toEqual(expect.any(Number));
      expect(message.payload).toEqual({ sku: "ABC123" });
    });

    it("should deliver to multiple subscribers", async () => {
      const received1: Message[] = [];
      const received2: Message[] = [];

      bus.subscribe("cart.item.add", (msg) => received1.push(msg));
      bus.subscribe("cart.item.add", (msg) => received2.push(msg));

      bus.publish("cart.item.add", { sku: "ABC123" });

      await flushMicrotasks();

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });

    it("should unsubscribe stops receiving messages", async () => {
      const received: Message[] = [];

      const unsubscribe = bus.subscribe("cart.item.add", (msg) => {
        received.push(msg);
      });

      bus.publish("cart.item.add", { first: true });
      await flushMicrotasks();
      expect(received).toHaveLength(1);

      unsubscribe();

      bus.publish("cart.item.add", { second: true });
      await flushMicrotasks();
      expect(received).toHaveLength(1);
    });

    it("should not receive messages for non-matching topics", async () => {
      const received: Message[] = [];

      bus.subscribe("cart.item.add", (msg) => received.push(msg));
      bus.publish("cart.item.remove", { sku: "ABC123" });

      await flushMicrotasks();

      expect(received).toHaveLength(0);
    });
  });

  describe("Wildcard subscriptions", () => {
    it("should single-level wildcard (+) matches one segment", async () => {
      const received: Message[] = [];

      bus.subscribe("cart.+.update", (msg) => received.push(msg));

      bus.publish("cart.item.update", { sku: "A" });
      bus.publish("cart.promo.update", { code: "B" });
      bus.publish("cart.item.detail.update", { deep: true });

      await flushMicrotasks();

      expect(received).toHaveLength(2);
      expect(received[0].topic).toBe("cart.item.update");
      expect(received[1].topic).toBe("cart.promo.update");
    });

    it("should multi-level wildcard (#) matches remaining segments", async () => {
      const received: Message[] = [];

      bus.subscribe("cart.#", (msg) => received.push(msg));

      bus.publish("cart.item", { a: 1 });
      bus.publish("cart.item.add", { b: 2 });
      bus.publish("cart.checkout.start", { c: 3 });
      bus.publish("user.login", { d: 4 });

      await flushMicrotasks();

      expect(received).toHaveLength(3);
    });

    it("should catch-all (#) receives all messages", async () => {
      const received: Message[] = [];

      bus.subscribe("#", (msg) => received.push(msg));

      bus.publish("cart.item.add", { a: 1 });
      bus.publish("user.login", { b: 2 });
      bus.publish("metrics", { c: 3 });

      await flushMicrotasks();

      expect(received).toHaveLength(3);
    });
  });

  describe("AbortSignal support", () => {
    it("should unsubscribe when signal is aborted", async () => {
      const received: Message[] = [];
      const controller = new AbortController();

      bus.subscribe("cart.item.add", (msg) => received.push(msg), {
        signal: controller.signal,
      });

      bus.publish("cart.item.add", { first: true });
      await flushMicrotasks();
      expect(received).toHaveLength(1);

      controller.abort();

      bus.publish("cart.item.add", { second: true });
      await flushMicrotasks();
      expect(received).toHaveLength(1);
    });

    it("should not subscribe if signal is already aborted", async () => {
      const received: Message[] = [];
      const controller = new AbortController();

      controller.abort();

      bus.subscribe("cart.item.add", (msg) => received.push(msg), {
        signal: controller.signal,
      });

      bus.publish("cart.item.add", { test: true });
      await flushMicrotasks();

      expect(received).toHaveLength(0);
    });
  });

  describe("Handlers isolation", () => {
    it("should not affect other handlers when one throws an error", async () => {
      const received: Message[] = [];
      const diagnostics: DiagnosticEvent[] = [];
      const busWithDiag = createPubSub({
        onDiagnostic: (event) => diagnostics.push(event),
      });

      busWithDiag.subscribe("test", () => {
        throw new Error("Handler 1 failed!");
      });

      busWithDiag.subscribe("test", (msg) => {
        received.push(msg);
      });

      busWithDiag.publish("test", { value: 42 });
      await flushMicrotasks();
      expect(received).toHaveLength(1);

      const errorEvent = diagnostics.find((d) => d.type === "handler-error");

      expect(errorEvent).toBeDefined();
      busWithDiag.dispose();
    });

    it("should async handler error is caught and logged", async () => {
      const diagnostics: DiagnosticEvent[] = [];
      const busWithDiag = createPubSub({
        onDiagnostic: (event) => diagnostics.push(event),
      });

      busWithDiag.subscribe("test", async () => {
        await Promise.resolve();
        throw new Error("Async failure!");
      });

      busWithDiag.publish("test", { value: 1 });
      await flushMicrotasks();

      // Wait a bit for the async error to be caught
      await new Promise((r) => setTimeout(r, 0));

      const errorEvent = diagnostics.find((d) => d.type === "handler-error");
      expect(errorEvent).toBeDefined();

      busWithDiag.dispose();
    });
  });

  describe("Source filtering", () => {
    it("should exclude filter ignores messages from specified sources", async () => {
      const received: Message[] = [];

      bus.subscribe("events", (msg) => received.push(msg), {
        sourceFilter: { exclude: ["self"] },
      });

      bus.publish("events", { a: 1 }, { source: "self" });
      bus.publish("events", { b: 2 }, { source: "other" });
      bus.publish("events", { c: 3 });

      await flushMicrotasks();

      expect(received).toHaveLength(2);
      expect(received[0].payload).toEqual({ b: 2 });
      expect(received[1].payload).toEqual({ c: 3 });
    });

    it("should include filter only accepts messages from specified sources", async () => {
      const received: Message[] = [];

      bus.subscribe("events", (msg) => received.push(msg), {
        sourceFilter: { include: ["trusted"] },
      });

      bus.publish("events", { a: 1 }, { source: "trusted" });
      bus.publish("events", { b: 2 }, { source: "untrusted" });
      bus.publish("events", { c: 3 });

      await flushMicrotasks();

      expect(received).toHaveLength(1);
      expect(received[0].payload).toEqual({ a: 1 });
    });
  });

  describe("Diagnostics", () => {
    it("should emit publish diagnostic", async () => {
      const diagnostics: DiagnosticEvent[] = [];
      const diagBus = createPubSub({
        onDiagnostic: (event) => diagnostics.push(event),
      });

      diagBus.subscribe("test", () => {});
      diagBus.publish("test", { value: 1 });

      const publishEvent = diagnostics.find((d) => d.type === "publish");

      expect(publishEvent).toBeDefined();
      expect(publishEvent?.type === "publish" && publishEvent.handlerCount).toBe(1);

      diagBus.dispose();
    });

    it("should emit subscribe/unsubscribe diagnostics", () => {
      const diagnostics: DiagnosticEvent[] = [];
      const diagBus = createPubSub({
        onDiagnostic: (event) => diagnostics.push(event),
      });

      const unsubscribe = diagBus.subscribe("test", () => {});
      const subEvent = diagnostics.find((d) => d.type === "subscribe");

      expect(subEvent).toBeDefined();
      unsubscribe();

      const unsubEvent = diagnostics.find((d) => d.type === "unsubscribe");

      expect(unsubEvent).toBeDefined();

      diagBus.dispose();
    });
  });

  describe("Handlers limits", () => {
    it("should not throw when max handlers was not exceeded", () => {
      const limitedBus = createPubSub({ maxHandlersPerTopic: 2 });

      limitedBus.subscribe("test", () => {});
      limitedBus.subscribe("test", () => {});

      expect(() => {
        limitedBus.subscribe("test", () => {});
      }).not.toThrow();

      limitedBus.dispose();
    });

    it("should throw when max handlers exceeded", () => {
      const limitedBus = createPubSub({ maxHandlersPerTopic: 2 });

      limitedBus.subscribe("test", () => {});
      limitedBus.subscribe("test", () => {});
      limitedBus.subscribe("test", () => {});

      expect(() => {
        limitedBus.subscribe("test", () => {});
      }).toThrow("Maximum handlers");

      limitedBus.dispose();
    });

    it("should warn instead of throwing when onMaxHandlersExceeded is 'warn'", () => {
      const diagnostics: DiagnosticEvent[] = [];
      const warnBus = createPubSub({
        maxHandlersPerTopic: 2,
        onMaxHandlersExceeded: "warn",
        onDiagnostic: (event) => diagnostics.push(event),
      });

      warnBus.subscribe("test", () => {});
      warnBus.subscribe("test", () => {});
      warnBus.subscribe("test", () => {});

      // Should NOT throw, but emit diagnostic
      const unsubscribe = warnBus.subscribe("test", () => {});

      expect(unsubscribe).toBeDefined();
      expect(typeof unsubscribe).toBe("function");

      const limitExceeded = diagnostics.find((d) => d.type === "limit-exceeded");

      expect(limitExceeded).toBeDefined();
      expect(limitExceeded?.message).toContain("Maximum handlers");

      warnBus.dispose();
    });

    it("should return no-op unsubscribe in warn mode when limit exceeded", async () => {
      const warnBus = createPubSub({
        maxHandlersPerTopic: 1,
        onMaxHandlersExceeded: "warn",
      });

      const received: Message[] = [];
      warnBus.subscribe("test", (msg) => received.push(msg));
      warnBus.subscribe("test", () => {});

      // Third subscription should be ignored
      const unsubscribe = warnBus.subscribe("test", (msg) => received.push(msg));

      warnBus.publish("test", { value: 1 });
      await flushMicrotasks();

      // Only first handler should have received (second was already over limit)
      expect(received).toHaveLength(1);

      // Calling no-op unsubscribe should not throw
      unsubscribe();

      warnBus.dispose();
    });

    it("should throw by default when max handlers exceeded (onMaxHandlersExceeded is 'throw')", () => {
      const diagnostics: DiagnosticEvent[] = [];
      const throwBus = createPubSub({
        maxHandlersPerTopic: 1,
        onMaxHandlersExceeded: "throw",
        onDiagnostic: (event) => diagnostics.push(event),
      });

      throwBus.subscribe("test", () => {});
      throwBus.subscribe("test", () => {});

      expect(() => {
        throwBus.subscribe("test", () => {});
      }).toThrow("Maximum handlers");

      // Should also emit diagnostic before throwing
      const limitExceeded = diagnostics.find((d) => d.type === "limit-exceeded");

      expect(limitExceeded).toBeDefined();

      throwBus.dispose();
    });
  });
});
