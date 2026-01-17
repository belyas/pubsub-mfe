import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { MessageBatcher, createMessageBatcher } from "./batching";
import type { CrossTabEnvelope } from "./types";

describe("MessageBatcher", () => {
  let flushedBatches: CrossTabEnvelope[][];
  let onFlush: (messages: CrossTabEnvelope[]) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    flushedBatches = [];
    onFlush = (messages) => {
      flushedBatches.push([...messages]);
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createEnvelope = (id: string): CrossTabEnvelope => ({
    messageId: id,
    clientId: "test-client",
    topic: "test.topic",
    payload: { data: "test" },
    timestamp: Date.now(),
    version: 1,
    origin: "http://localhost",
  });

  describe("Constructor", () => {
    it("should create batcher with required config", () => {
      const batcher = new MessageBatcher({
        intervalMs: 10,
        onFlush,
      });

      expect(batcher.isDisposed()).toBe(false);
      expect(batcher.getStats().totalMessages).toBe(0);

      batcher.dispose();
    });

    it("should use default maxBatchSize", () => {
      const batcher = new MessageBatcher({
        intervalMs: 10,
        onFlush,
      });

      expect(batcher.getStats()).toMatchObject({
        totalMessages: 0,
        totalBatches: 0,
      });

      batcher.dispose();
    });

    it("should accept custom maxBatchSize", () => {
      const batcher = new MessageBatcher({
        intervalMs: 10,
        maxBatchSize: 100,
        onFlush,
      });

      expect(batcher).toBeDefined();

      batcher.dispose();
    });
  });

  describe("Add and flush", () => {
    it("should batch messages and flush after interval", () => {
      const batcher = new MessageBatcher({
        intervalMs: 10,
        onFlush,
      });

      batcher.add(createEnvelope("msg-1"));
      batcher.add(createEnvelope("msg-2"));
      batcher.add(createEnvelope("msg-3"));

      expect(flushedBatches).toHaveLength(0);

      vi.advanceTimersByTime(10);

      expect(flushedBatches).toHaveLength(1);
      expect(flushedBatches[0]).toHaveLength(3);
      expect(flushedBatches[0][0].messageId).toBe("msg-1");
      expect(flushedBatches[0][1].messageId).toBe("msg-2");
      expect(flushedBatches[0][2].messageId).toBe("msg-3");

      batcher.dispose();
    });

    it("should flush immediately when batch is full", () => {
      const batcher = new MessageBatcher({
        intervalMs: 100,
        maxBatchSize: 3,
        onFlush,
      });

      batcher.add(createEnvelope("msg-1"));
      batcher.add(createEnvelope("msg-2"));
      expect(flushedBatches).toHaveLength(0);

      batcher.add(createEnvelope("msg-3")); // Reaches maxBatchSize

      expect(flushedBatches).toHaveLength(1);
      expect(flushedBatches[0]).toHaveLength(3);

      batcher.dispose();
    });

    it("should handle multiple batches", () => {
      const batcher = new MessageBatcher({
        intervalMs: 10,
        onFlush,
      });

      // First batch
      batcher.add(createEnvelope("msg-1"));
      batcher.add(createEnvelope("msg-2"));
      vi.advanceTimersByTime(10);

      expect(flushedBatches).toHaveLength(1);

      // Second batch
      batcher.add(createEnvelope("msg-3"));
      batcher.add(createEnvelope("msg-4"));
      vi.advanceTimersByTime(10);

      expect(flushedBatches).toHaveLength(2);
      expect(flushedBatches[1]).toHaveLength(2);

      batcher.dispose();
    });

    it("should not flush empty buffer", () => {
      const batcher = new MessageBatcher({
        intervalMs: 10,
        onFlush,
      });

      batcher.flush();

      expect(flushedBatches).toHaveLength(0);

      batcher.dispose();
    });

    it("should handle single message batches", () => {
      const batcher = new MessageBatcher({
        intervalMs: 10,
        onFlush,
      });

      batcher.add(createEnvelope("msg-1"));
      vi.advanceTimersByTime(10);

      expect(flushedBatches).toHaveLength(1);
      expect(flushedBatches[0]).toHaveLength(1);

      batcher.dispose();
    });

    it("should clear timer after manual flush", () => {
      const batcher = new MessageBatcher({
        intervalMs: 100,
        onFlush,
      });

      batcher.add(createEnvelope("msg-1"));
      batcher.flush();

      expect(flushedBatches).toHaveLength(1);

      // Timer should be cleared, advancing time should not trigger another flush
      vi.advanceTimersByTime(100);
      expect(flushedBatches).toHaveLength(1);

      batcher.dispose();
    });
  });

  describe("GetStats", () => {
    it("should track total messages", () => {
      const batcher = new MessageBatcher({
        intervalMs: 10,
        onFlush,
      });

      batcher.add(createEnvelope("msg-1"));
      batcher.add(createEnvelope("msg-2"));
      batcher.add(createEnvelope("msg-3"));

      expect(batcher.getStats().totalMessages).toBe(3);

      batcher.dispose();
    });

    it("should track total batches", () => {
      const batcher = new MessageBatcher({
        intervalMs: 10,
        onFlush,
      });

      batcher.add(createEnvelope("msg-1"));
      vi.advanceTimersByTime(10);

      batcher.add(createEnvelope("msg-2"));
      vi.advanceTimersByTime(10);

      expect(batcher.getStats().totalBatches).toBe(2);

      batcher.dispose();
    });

    it("should track max batch size", () => {
      const batcher = new MessageBatcher({
        intervalMs: 10,
        onFlush,
      });

      batcher.add(createEnvelope("msg-1"));
      vi.advanceTimersByTime(10);

      batcher.add(createEnvelope("msg-2"));
      batcher.add(createEnvelope("msg-3"));
      batcher.add(createEnvelope("msg-4"));
      vi.advanceTimersByTime(10);

      expect(batcher.getStats().maxBatchSize).toBe(3);

      batcher.dispose();
    });

    it("should calculate average batch size", () => {
      const batcher = new MessageBatcher({
        intervalMs: 10,
        onFlush,
      });

      batcher.add(createEnvelope("msg-1"));
      batcher.add(createEnvelope("msg-2"));
      vi.advanceTimersByTime(10);

      batcher.add(createEnvelope("msg-3"));
      batcher.add(createEnvelope("msg-4"));
      batcher.add(createEnvelope("msg-5"));
      batcher.add(createEnvelope("msg-6"));
      vi.advanceTimersByTime(10);

      const stats = batcher.getStats();
      expect(stats.averageBatchSize).toBe(3); // (2 + 4) / 2

      batcher.dispose();
    });

    it("should return current buffer size", () => {
      const batcher = new MessageBatcher({
        intervalMs: 10,
        onFlush,
      });

      expect(batcher.getStats().currentBufferSize).toBe(0);

      batcher.add(createEnvelope("msg-1"));
      batcher.add(createEnvelope("msg-2"));

      expect(batcher.getStats().currentBufferSize).toBe(2);

      vi.advanceTimersByTime(10);

      expect(batcher.getStats().currentBufferSize).toBe(0);

      batcher.dispose();
    });
  });

  describe("Dispose", () => {
    it("should flush remaining messages on dispose", () => {
      const batcher = new MessageBatcher({
        intervalMs: 100,
        onFlush,
      });

      batcher.add(createEnvelope("msg-1"));
      batcher.add(createEnvelope("msg-2"));

      expect(flushedBatches).toHaveLength(0);

      batcher.dispose();

      expect(flushedBatches).toHaveLength(1);
      expect(flushedBatches[0]).toHaveLength(2);
    });

    it("should be idempotent", () => {
      const batcher = new MessageBatcher({
        intervalMs: 10,
        onFlush,
      });

      batcher.add(createEnvelope("msg-1"));
      batcher.dispose();
      batcher.dispose(); // Second dispose should be safe

      expect(flushedBatches).toHaveLength(1);
      expect(batcher.isDisposed()).toBe(true);
    });

    it("should throw when adding to disposed batcher", () => {
      const batcher = new MessageBatcher({
        intervalMs: 10,
        onFlush,
      });

      batcher.dispose();

      expect(() => {
        batcher.add(createEnvelope("msg-1"));
      }).toThrow("MessageBatcher is disposed");
    });
  });

  describe("CreateMessageBatcher factory", () => {
    it("should create batcher instance", () => {
      const batcher = createMessageBatcher({
        intervalMs: 10,
        onFlush,
      });

      expect(batcher).toBeInstanceOf(MessageBatcher);
      expect(batcher.isDisposed()).toBe(false);

      batcher.dispose();
    });

    it("should create functional batcher", () => {
      const batcher = createMessageBatcher({
        intervalMs: 10,
        maxBatchSize: 50,
        onFlush,
      });

      batcher.add(createEnvelope("msg-1"));
      vi.advanceTimersByTime(10);

      expect(flushedBatches).toHaveLength(1);

      batcher.dispose();
    });
  });

  describe("Edge cases", () => {
    it("should handle rapid successive adds", () => {
      const batcher = new MessageBatcher({
        intervalMs: 10,
        maxBatchSize: 200, // Large enough to not trigger auto-flush
        onFlush,
      });

      for (let i = 0; i < 100; i++) {
        batcher.add(createEnvelope(`msg-${i}`));
      }

      vi.advanceTimersByTime(10);

      expect(flushedBatches).toHaveLength(1);
      expect(flushedBatches[0]).toHaveLength(100);

      batcher.dispose();
    });

    it("should handle zero interval (immediate flush)", () => {
      const batcher = new MessageBatcher({
        intervalMs: 0,
        onFlush,
      });

      batcher.add(createEnvelope("msg-1"));

      vi.advanceTimersByTime(0);

      expect(flushedBatches).toHaveLength(1);

      batcher.dispose();
    });

    it("should handle manual flush during timer", () => {
      const batcher = new MessageBatcher({
        intervalMs: 100,
        onFlush,
      });

      batcher.add(createEnvelope("msg-1"));
      vi.advanceTimersByTime(50); // Halfway through interval

      batcher.flush();

      expect(flushedBatches).toHaveLength(1);

      vi.advanceTimersByTime(50); // Complete original interval

      // Should not flush again since timer was cleared
      expect(flushedBatches).toHaveLength(1);

      batcher.dispose();
    });

    it("should handle messages added after flush", () => {
      const batcher = new MessageBatcher({
        intervalMs: 10,
        onFlush,
      });

      batcher.add(createEnvelope("msg-1"));
      vi.advanceTimersByTime(10);

      expect(flushedBatches).toHaveLength(1);

      batcher.add(createEnvelope("msg-2"));
      vi.advanceTimersByTime(10);

      expect(flushedBatches).toHaveLength(2);

      batcher.dispose();
    });
  });
});
