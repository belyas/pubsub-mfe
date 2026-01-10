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

  describe("Lifecycle", () => {
    it("should remove all subscriptions", async () => {
      const received: Message[] = [];

      bus.subscribe("test", (msg) => received.push(msg));

      expect(bus.handlerCount()).toBe(1);
      bus.clear();
      expect(bus.handlerCount()).toBe(0);

      bus.publish("test", {});
      await flushMicrotasks();
      expect(received).toHaveLength(0);
    });

    it("should 'dispose' prevent further operations", () => {
      bus.dispose();

      expect(() => bus.subscribe("test", () => {})).toThrow(
        "Cannot subscribe: bus has been disposed."
      );
      expect(() => bus.publish("test", {})).toThrow("Cannot publish: bus has been disposed.");
    });

    it("should 'handlerCount' return correct counts", () => {
      expect(bus.handlerCount()).toBe(0);

      bus.subscribe("topic1", () => {});
      expect(bus.handlerCount()).toBe(1);
      expect(bus.handlerCount("topic1")).toBe(1);
      expect(bus.handlerCount("topic2")).toBe(0);

      bus.subscribe("topic1", () => {});
      bus.subscribe("topic2", () => {});
      expect(bus.handlerCount()).toBe(3);
    });
  });

  describe("Topic validation", () => {
    it("should reject publish with wildcards", () => {
      expect(() => bus.publish("cart.+.add", {})).toThrow(
        'Invalid publish topic "cart.+.add": wildcards (+ or #) are not allowed in publish topics. Use exact topic names for publishing.'
      );
      expect(() => bus.publish("cart.#", {})).toThrow(
        'Invalid publish topic "cart.#": wildcards (+ or #) are not allowed in publish topics. Use exact topic names for publishing.'
      );
    });

    it("should reject empty topics", () => {
      expect(() => bus.publish("", {})).toThrow("Invalid topic: empty.");
    });

    it("should reject topics with empty segments", () => {
      expect(() => bus.publish("cart..item", {})).toThrow(
        'Invalid topic "cart..item": empty segment at position 1'
      );
    });

    it("should emit diagnostic when topic validation fails", () => {
      const diagnostics: DiagnosticEvent[] = [];
      const diagBus = createPubSub({
        onDiagnostic: (event) => diagnostics.push(event),
      });

      expect(() => diagBus.publish("cart.+.add", {})).toThrow(
        'Invalid publish topic "cart.+.add": wildcards (+ or #) are not allowed in publish topics. Use exact topic names for publishing.'
      );

      const warning = diagnostics.find((d) => d.type === "warning");
      expect(warning).toBeDefined();
      expect(warning?.message).toContain("wildcards");

      diagBus.dispose();
    });
  });

  describe("Message retention and replay", () => {
    it("should replay retained messages to new subscriber", () => {
      const retentionBus = createPubSub({
        retention: { maxMessages: 10 },
      });

      retentionBus.publish("cart.item.add", { sku: "A" });
      retentionBus.publish("cart.item.add", { sku: "B" });
      retentionBus.publish("cart.item.add", { sku: "C" });

      const received: Message[] = [];

      retentionBus.subscribe(
        "cart.item.add",
        (msg) => {
          received.push(msg);
        },
        { replay: 5 }
      );

      expect(received).toHaveLength(3);
      expect(received[0].payload).toEqual({ sku: "A" });
      expect(received[1].payload).toEqual({ sku: "B" });
      expect(received[2].payload).toEqual({ sku: "C" });

      retentionBus.dispose();
    });

    it("should replay only last N messages when more are available", () => {
      const retentionBus = createPubSub({
        retention: { maxMessages: 10 },
      });

      for (let i = 1; i <= 5; i++) {
        retentionBus.publish("events", { n: i });
      }

      const received: Message[] = [];
      retentionBus.subscribe(
        "events",
        (msg) => {
          received.push(msg);
        },
        { replay: 2 }
      );

      expect(received).toHaveLength(2);
      expect(received[0].payload).toEqual({ n: 4 });
      expect(received[1].payload).toEqual({ n: 5 });

      retentionBus.dispose();
    });

    it("should respect circular buffer limit", () => {
      const retentionBus = createPubSub({
        retention: { maxMessages: 3 },
      });

      for (let i = 1; i <= 5; i++) {
        retentionBus.publish("events", { n: i });
      }

      const received: Message[] = [];

      retentionBus.subscribe(
        "events",
        (msg) => {
          received.push(msg);
        },
        { replay: 10 }
      );

      expect(received).toHaveLength(3);
      expect(received[0].payload).toEqual({ n: 3 });
      expect(received[1].payload).toEqual({ n: 4 });
      expect(received[2].payload).toEqual({ n: 5 });

      retentionBus.dispose();
    });

    it("should replay only messages matching the pattern", () => {
      const retentionBus = createPubSub({
        retention: { maxMessages: 10 },
      });

      retentionBus.publish("cart.item.add", { item: 1 });
      retentionBus.publish("user.login", { user: "a" });
      retentionBus.publish("cart.item.remove", { item: 2 });
      retentionBus.publish("user.logout", { user: "a" });
      retentionBus.publish("cart.checkout.start", { total: 100 });

      const received: Message[] = [];

      retentionBus.subscribe(
        "cart.#",
        (msg) => {
          received.push(msg);
        },
        { replay: 10 }
      );

      expect(received).toHaveLength(3);
      expect(received[0].topic).toBe("cart.item.add");
      expect(received[1].topic).toBe("cart.item.remove");
      expect(received[2].topic).toBe("cart.checkout.start");

      retentionBus.dispose();
    });

    it("should replay with single-level wildcard", () => {
      const retentionBus = createPubSub({
        retention: { maxMessages: 10 },
      });

      retentionBus.publish("cart.item.update", { a: 1 });
      retentionBus.publish("cart.promo.update", { b: 2 });
      retentionBus.publish("cart.item.detail.update", { c: 3 });

      const received: Message[] = [];
      retentionBus.subscribe(
        "cart.+.update",
        (msg) => {
          received.push(msg);
        },
        { replay: 10 }
      );

      expect(received).toHaveLength(2);
      expect(received[0].topic).toBe("cart.item.update");
      expect(received[1].topic).toBe("cart.promo.update");

      retentionBus.dispose();
    });

    it("should do nothing when retention is not configured", () => {
      const received: Message[] = [];

      bus.publish("test", { before: true });
      bus.subscribe(
        "test",
        (msg) => {
          received.push(msg);
        },
        { replay: 5 }
      );

      // No replay since retention is not configured
      expect(received).toHaveLength(0);
    });

    it("should respect TTL when replaying", async () => {
      const retentionBus = createPubSub({
        retention: { maxMessages: 10, ttlMs: 50 }, // 50ms TTL
      });

      retentionBus.publish("events", { n: 1 });

      // Wait for message to expire
      await new Promise((r) => setTimeout(r, 70));

      retentionBus.publish("events", { n: 2 });

      const received: Message[] = [];

      retentionBus.subscribe(
        "events",
        (msg) => {
          received.push(msg);
        },
        { replay: 10 }
      );

      expect(received).toHaveLength(1);
      expect(received[0].payload).toEqual({ n: 2 });

      retentionBus.dispose();
    });

    it("should continue to receive live messages after replay", async () => {
      const retentionBus = createPubSub({
        retention: { maxMessages: 10 },
      });

      retentionBus.publish("events", { type: "old" });

      const received: Message[] = [];

      retentionBus.subscribe(
        "events",
        (msg) => {
          received.push(msg);
        },
        { replay: 5 }
      );

      expect(received).toHaveLength(1);
      expect(received[0].payload).toEqual({ type: "old" });

      retentionBus.publish("events", { type: "new" });
      await flushMicrotasks();

      // Should have both old (replay) and new (live)
      expect(received).toHaveLength(2);
      expect(received[1].payload).toEqual({ type: "new" });

      retentionBus.dispose();
    });

    it("should clear retention buffer on clear()", () => {
      const retentionBus = createPubSub({
        retention: { maxMessages: 10 },
      });

      retentionBus.publish("events", { a: 1 });
      retentionBus.publish("events", { b: 2 });

      retentionBus.clear();

      const received: Message[] = [];

      retentionBus.subscribe(
        "events",
        (msg) => {
          received.push(msg);
        },
        { replay: 10 }
      );

      expect(received).toHaveLength(0);

      retentionBus.dispose();
    });
  });

  describe("Rate limiting", () => {
    it("should allow messages within rate limit", async () => {
      const rateLimitedBus = createPubSub({
        app: "rate-test",
        rateLimit: { maxPerSecond: 10, maxBurst: 5 },
      });

      const received: Message[] = [];

      rateLimitedBus.subscribe("test.topic", (msg) => received.push(msg));

      for (let i = 0; i < 5; i++) {
        rateLimitedBus.publish("test.topic", { index: i });
      }

      await flushMicrotasks();

      expect(received).toHaveLength(5);

      rateLimitedBus.dispose();
    });

    it("should drop messages when rate limit exceeded with drop mode", async () => {
      const diagnosticEvents: DiagnosticEvent[] = [];
      const rateLimitedBus = createPubSub({
        app: "rate-test",
        rateLimit: { maxPerSecond: 5, maxBurst: 3, onExceeded: "drop" },
        onDiagnostic: (event) => diagnosticEvents.push(event),
      });

      const received: Message[] = [];

      rateLimitedBus.subscribe("test.topic", (msg) => received.push(msg));

      for (let i = 0; i < 10; i++) {
        rateLimitedBus.publish("test.topic", { index: i });
      }

      await flushMicrotasks();

      // Only first 3 should be delivered (burst limit)
      expect(received).toHaveLength(3);

      // Should have rate-limited diagnostics
      const rateLimitedEvents = diagnosticEvents.filter((e) => e.type === "rate-limited");

      expect(rateLimitedEvents.length).toBeGreaterThan(0);

      rateLimitedBus.dispose();
    });

    it("should throw error when rate limit exceeded with throw mode", () => {
      const rateLimitedBus = createPubSub({
        app: "rate-test",
        rateLimit: { maxPerSecond: 5, maxBurst: 2, onExceeded: "throw" },
      });

      rateLimitedBus.publish("test.topic", { index: 0 });
      rateLimitedBus.publish("test.topic", { index: 1 });

      expect(() => {
        rateLimitedBus.publish("test.topic", { index: 2 });
      }).toThrow(/rate limit exceeded/i);

      rateLimitedBus.dispose();
    });

    it("should refill tokens over time", async () => {
      const rateLimitedBus = createPubSub({
        app: "rate-test",
        rateLimit: { maxPerSecond: 1000, maxBurst: 2 }, // High rate so tokens refill quickly
      });

      const received: Message[] = [];

      rateLimitedBus.subscribe("test.topic", (msg) => received.push(msg));

      // Exhaust burst tokens
      rateLimitedBus.publish("test.topic", { index: 0 });
      rateLimitedBus.publish("test.topic", { index: 1 });

      // Wait a bit for tokens to refill (at 1000/sec, 10ms = 10 tokens)
      await new Promise((resolve) => setTimeout(resolve, 15));

      rateLimitedBus.publish("test.topic", { index: 2 });

      await flushMicrotasks();

      expect(received).toHaveLength(3);

      rateLimitedBus.dispose();
    });

    it("should mark rate-limited messages with meta flag in drop mode", () => {
      const rateLimitedBus = createPubSub({
        app: "rate-test",
        rateLimit: { maxPerSecond: 5, maxBurst: 1, onExceeded: "drop" },
      });
      const msg1 = rateLimitedBus.publish("test.topic", { index: 0 });

      expect(msg1.meta?._rateLimited).toBeUndefined();

      // Second message is rate-limited
      const msg2 = rateLimitedBus.publish("test.topic", { index: 1 });

      expect(msg2.meta?._rateLimited).toBe(true);

      rateLimitedBus.dispose();
    });
  });

  describe("Schema validation", () => {
    it("should validate payload in strict mode", () => {
      const strictBus = createPubSub({ validationMode: "strict" });

      strictBus.registerSchema("cart.item@1", {
        type: "object",
        properties: {
          sku: { type: "string" },
          qty: { type: "number", minimum: 1 },
        },
        required: ["sku", "qty"],
      });

      expect(() => {
        strictBus.publish(
          "cart.item.add",
          { sku: "ABC", qty: 1 },
          {
            schemaVersion: "cart.item@1",
          }
        );
      }).not.toThrow();

      expect(() => {
        strictBus.publish(
          "cart.item.add",
          { sku: "ABC", qty: 0 },
          {
            schemaVersion: "cart.item@1",
          }
        );
      }).toThrow("Validation failed");

      strictBus.dispose();
    });

    it("should log but continues in warn mode", async () => {
      const diagnostics: DiagnosticEvent[] = [];
      const warnBus = createPubSub({
        validationMode: "warn",
        onDiagnostic: (event) => diagnostics.push(event),
      });
      const received: Message[] = [];

      warnBus.registerSchema("test@1", {
        type: "object",
        properties: { value: { type: "number" } },
        required: ["value"],
      });
      warnBus.subscribe("test", (msg) => received.push(msg));
      warnBus.publish("test", {}, { schemaVersion: "test@1" });
      await flushMicrotasks();

      expect(received).toHaveLength(1);

      const validationError = diagnostics.find((d) => d.type === "validation-error");
      expect(validationError).toBeDefined();

      warnBus.dispose();
    });

    it("should throw in strict mode when schema not registered", () => {
      const strictBus = createPubSub({ validationMode: "strict" });

      expect(() => {
        strictBus.publish("test", {}, { schemaVersion: "unknown@1" });
      }).toThrow("not registered");

      strictBus.dispose();
    });

    it("should skip validation when mode is off", () => {
      expect(() => {
        bus.publish("test", {}, { schemaVersion: "unknown@1" });
      }).not.toThrow();
    });
  });

  describe("Message metadata", () => {
    it("should include source and correlationId in meta", async () => {
      const received: Message[] = [];

      bus.subscribe("test", (msg) => received.push(msg));
      bus.publish(
        "test",
        { value: 1 },
        {
          source: "cart-mfe",
          correlationId: "request-123",
        }
      );

      await flushMicrotasks();

      expect(received[0].meta?.source).toBe("cart-mfe");
      expect(received[0].meta?.correlationId).toBe("request-123");
    });

    it("should include schemaVersion when specified", async () => {
      bus.registerSchema("test@1", { type: "object" });

      const received: Message[] = [];

      bus.subscribe("test", (msg) => received.push(msg));
      bus.publish("test", {}, { schemaVersion: "test@1" });

      await flushMicrotasks();

      expect(received[0].schemaVersion).toBe("test@1");
    });
  });
});
