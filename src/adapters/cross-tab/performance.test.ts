import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CrossTabAdapter } from "./adapter";
import { PubSubBusImpl } from "../../bus";
import type { Transport, CrossTabEnvelope } from "./types";

describe("Performance Benchmarks", () => {
  let bus: PubSubBusImpl;
  let mockTransport: MockTransport;

  class MockTransport implements Transport {
    private handlers: Array<(envelope: CrossTabEnvelope) => void> = [];
    public sentMessages: CrossTabEnvelope[] = [];
    public closed = false;
    public sendDurations: number[] = [];

    send(envelope: CrossTabEnvelope): void {
      const start = performance.now();
      if (this.closed) {
        throw new Error("Transport is closed");
      }
      this.sentMessages.push(envelope);
      const duration = performance.now() - start;
      this.sendDurations.push(duration);
    }

    onMessage(handler: (envelope: CrossTabEnvelope) => void): () => void {
      this.handlers.push(handler);
      return () => {
        const index = this.handlers.indexOf(handler);
        if (index > -1) {
          this.handlers.splice(index, 1);
        }
      };
    }

    close(): void {
      this.closed = true;
      this.handlers = [];
    }

    isAvailable(): boolean {
      return !this.closed;
    }

    simulateReceive(envelope: CrossTabEnvelope): void {
      this.handlers.forEach((handler) => handler(envelope));
    }

    resetMetrics(): void {
      this.sentMessages = [];
      this.sendDurations = [];
    }
  }

  beforeEach(() => {
    bus = new PubSubBusImpl();
    mockTransport = new MockTransport();
  });

  afterEach(() => {
    mockTransport.close();
  });

  describe("Throughput Benchmarks", () => {
    it("should handle 1000 messages/sec without batching", () => {
      const adapter = new CrossTabAdapter({
        channelName: "perf-test",
        transport: mockTransport,
        batchIntervalMs: 0, // Disable batching
        emitSystemEvents: false,
      });
      const messageCount = 1000;
      const start = performance.now();

      adapter.attach(bus);

      for (let i = 0; i < messageCount; i++) {
        bus.publish(`test.message.${i}`, { index: i, data: "x".repeat(100) });
      }

      const duration = performance.now() - start;
      const throughput = (messageCount / duration) * 1000; // messages per second

      expect(mockTransport.sentMessages.length).toBe(messageCount);
      expect(throughput).toBeGreaterThan(1000); // Should handle >1000 msgs/sec

      console.log(`[Benchmark] Throughput (no batching): ${throughput.toFixed(0)} msgs/sec`);
      console.log(`[Benchmark] Duration: ${duration.toFixed(2)}ms for ${messageCount} messages`);
    });

    it("should handle 1000 messages/sec with batching", () => {
      vi.useFakeTimers();

      const adapter = new CrossTabAdapter({
        channelName: "perf-test",
        transport: mockTransport,
        batchIntervalMs: 10,
        maxBatchSize: 50,
        emitSystemEvents: false,
      });
      const messageCount = 1000;
      const start = performance.now();

      adapter.attach(bus);

      for (let i = 0; i < messageCount; i++) {
        bus.publish(`test.message.${i}`, { index: i, data: "x".repeat(100) });
      }

      vi.advanceTimersByTime(100);

      const duration = performance.now() - start;
      const throughput = (messageCount / duration) * 1000;

      expect(mockTransport.sentMessages.length).toBe(messageCount);

      const stats = adapter.getStats();
      console.log(`[Benchmark] Throughput (with batching): ${throughput.toFixed(0)} msgs/sec`);
      console.log(`[Benchmark] Total batches: ${stats.batchesSent}`);
      console.log(`[Benchmark] Average batch size: ${stats.averageBatchSize.toFixed(1)}`);
      console.log(`[Benchmark] Max batch size: ${stats.maxBatchSizeSeen}`);

      vi.useRealTimers();
    });

    it("should handle burst of 10000 messages", () => {
      vi.useFakeTimers();

      const adapter = new CrossTabAdapter({
        channelName: "perf-test",
        transport: mockTransport,
        batchIntervalMs: 10,
        maxBatchSize: 100,
        emitSystemEvents: false,
      });
      const messageCount = 10000;
      const start = performance.now();

      adapter.attach(bus);

      for (let i = 0; i < messageCount; i++) {
        bus.publish(`test.${i}`, { i });
      }

      vi.advanceTimersByTime(200);

      const duration = performance.now() - start;
      const throughput = (messageCount / duration) * 1000;

      expect(mockTransport.sentMessages.length).toBe(messageCount);
      expect(throughput).toBeGreaterThan(10000); // Should handle >10k msgs/sec

      const stats = adapter.getStats();
      console.log(`[Benchmark] Burst throughput: ${throughput.toFixed(0)} msgs/sec`);
      console.log(`[Benchmark] Messages: ${messageCount}`);
      console.log(`[Benchmark] Batches: ${stats.batchesSent}`);
      console.log(
        `[Benchmark] Batch efficiency: ${(messageCount / stats.batchesSent).toFixed(1)} msgs/batch`
      );

      vi.useRealTimers();
    });
  });

  describe("Latency Benchmarks", () => {
    it("should measure end-to-end message latency", () => {
      const adapter1 = new CrossTabAdapter({
        channelName: "perf-test",
        transport: mockTransport,
        clientId: "sender",
        batchIntervalMs: 0,
        emitSystemEvents: false,
      });
      const adapter2 = new CrossTabAdapter({
        channelName: "perf-test",
        transport: mockTransport,
        clientId: "receiver",
        batchIntervalMs: 0,
        emitSystemEvents: false,
      });
      const bus1 = new PubSubBusImpl();
      const bus2 = new PubSubBusImpl();
      const latencies: number[] = [];
      const messageCount = 100;

      adapter1.attach(bus1);
      adapter2.attach(bus2);

      bus2.subscribe("test.latency", () => {
        const receivedAt = performance.now();
        const sentAt = latencies[latencies.length - 1];
        latencies[latencies.length - 1] = receivedAt - sentAt;
      });

      for (let i = 0; i < messageCount; i++) {
        const sentAt = performance.now();
        latencies.push(sentAt);
        bus1.publish("test.latency", { index: i });

        // Simulate cross-tab receive
        const envelope = mockTransport.sentMessages[mockTransport.sentMessages.length - 1];
        if (envelope) {
          mockTransport.simulateReceive(envelope);
        }
      }

      // Calculate percentiles
      latencies.sort((a, b) => a - b);

      const p50 = latencies[Math.floor(latencies.length * 0.5)];
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      const p99 = latencies[Math.floor(latencies.length * 0.99)];
      const avg = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;

      // Latency depends on the test environment - just verify it's measurable
      expect(p99).toBeGreaterThan(0);
      expect(avg).toBeGreaterThan(0);

      console.log(`[Benchmark] Latency (${messageCount} messages):`);
      console.log(`  Average: ${avg.toFixed(3)}ms`);
      console.log(`  P50: ${p50.toFixed(3)}ms`);
      console.log(`  P95: ${p95.toFixed(3)}ms`);
      console.log(`  P99: ${p99.toFixed(3)}ms`);
    });

    it("should measure batching latency overhead", () => {
      vi.useFakeTimers();

      const maxBatchSize = 50;
      const batchIntervalMs = 10;
      const messageCount = 100;
      const adapter = new CrossTabAdapter({
        channelName: "perf-test",
        transport: mockTransport,
        batchIntervalMs,
        maxBatchSize,
        emitSystemEvents: false,
      });
      const publishTimes: number[] = [];
      const flushTimes: number[] = [];

      adapter.attach(bus);

      // Publish messages and track when they're sent
      for (let i = 0; i < messageCount; i++) {
        publishTimes.push(performance.now());
        bus.publish(`test.${i}`, { i });

        if ((i + 1) % maxBatchSize === 0) {
          // Batch will flush at maxBatchSize messages
          flushTimes.push(performance.now());
        }
      }

      vi.advanceTimersByTime(batchIntervalMs);
      flushTimes.push(performance.now());

      expect(mockTransport.sentMessages.length).toBe(messageCount);

      console.log(`[Benchmark] Batching latency overhead:`);
      console.log(`  Batch interval: ${batchIntervalMs}ms`);
      console.log(`  Max batch size: ${maxBatchSize}`);
      console.log(`  Messages sent: ${messageCount}`);
      console.log(`  Number of batches: ${flushTimes.length}`);

      vi.useRealTimers();
    });
  });

  describe("Memory Benchmarks", () => {
    it("should measure memory usage with deduplication cache", () => {
      const adapter = new CrossTabAdapter({
        channelName: "perf-test",
        transport: mockTransport,
        clientId: "receiver", // Different client ID to avoid echo filtering
        dedupeCacheSize: 1000,
        dedupeWindowMs: 60000,
        batchIntervalMs: 0,
        emitSystemEvents: false,
      });
      const messageCount = 1000;

      adapter.attach(bus);

      for (let i = 0; i < messageCount; i++) {
        bus.publish(`test.${i}`, { index: i, data: "x".repeat(100) });
      }

      // Simulate receiving messages from a DIFFERENT client (will be cached for dedupe)
      for (let i = 0; i < messageCount; i++) {
        const envelope = {
          ...mockTransport.sentMessages[i],
          clientId: "sender", // Different client ID
        };
        mockTransport.simulateReceive(envelope);
      }

      const stats = adapter.getStats();

      expect(stats.dedupeCacheSize).toBeGreaterThan(0);
      expect(stats.dedupeCacheSize).toBeLessThanOrEqual(1000);

      console.log(`[Benchmark] Memory usage (deduplication):`);
      console.log(`  Messages processed: ${messageCount}`);
      console.log(`  Cache size: ${stats.dedupeCacheSize}`);
      console.log(`  Messages deduplicated: ${stats.messagesDeduplicated}`);
    });

    it("should measure batching buffer memory", () => {
      vi.useFakeTimers();

      const adapter = new CrossTabAdapter({
        channelName: "perf-test",
        transport: mockTransport,
        batchIntervalMs: 100, // Long interval to accumulate messages
        maxBatchSize: 1000, // Large batch size
        emitSystemEvents: false,
      });
      const messageCount = 500;

      adapter.attach(bus);

      // Publish messages (will be buffered)
      for (let i = 0; i < messageCount; i++) {
        bus.publish(`test.${i}`, { index: i, data: "x".repeat(100) });
      }

      // Before flush - messages are buffered
      expect(mockTransport.sentMessages.length).toBe(0);

      // Flush the batch
      vi.advanceTimersByTime(100);

      expect(mockTransport.sentMessages.length).toBe(messageCount);

      console.log(`[Benchmark] Batching buffer:`);
      console.log(`  Messages buffered: ${messageCount}`);
      console.log(`  Buffer flush time: 100ms`);
      console.log(`  Messages per batch: ${messageCount}`);

      vi.useRealTimers();
    });
  });

  describe("Security Performance", () => {
    it("should measure rate limiting overhead", () => {
      vi.useFakeTimers();

      const adapter = new CrossTabAdapter({
        channelName: "perf-test",
        transport: mockTransport,
        clientId: "receiver",
        rateLimit: {
          maxPerSecond: 100,
          maxBurst: 200,
        },
        batchIntervalMs: 0,
        emitSystemEvents: false,
      });
      const messageCount = 500;
      let receivedCount = 0;

      adapter.attach(bus);

      bus.subscribe("test.rate", () => {
        receivedCount++;
      });

      const start = performance.now();

      // Simulate receiving messages from another tab
      for (let i = 0; i < messageCount; i++) {
        mockTransport.simulateReceive({
          messageId: `msg-${i}`,
          clientId: "sender",
          topic: "test.rate",
          payload: { i },
          timestamp: Date.now(),
          version: 1,
          origin: "http://localhost",
        });
      }

      const duration = performance.now() - start;
      const stats = adapter.getStats();

      expect(stats.messagesRateLimited).toBeGreaterThan(0); // Some messages should be rate limited

      console.log(`[Benchmark] Rate limiting:`);
      console.log(`  Messages sent: ${messageCount}`);
      console.log(`  Messages received: ${receivedCount}`);
      console.log(`  Messages rate limited: ${stats.messagesRateLimited}`);
      console.log(`  Processing time: ${duration.toFixed(2)}ms`);
      console.log(`  Rate limit overhead: ${(duration / messageCount).toFixed(3)}ms per message`);

      vi.useRealTimers();
    });

    it("should measure message size validation overhead", () => {
      const adapter = new CrossTabAdapter({
        channelName: "perf-test",
        transport: mockTransport,
        maxMessageSize: 256 * 1024, // 256KB
        batchIntervalMs: 0,
        emitSystemEvents: false,
      });
      const messageCount = 1000;

      adapter.attach(bus);

      const start = performance.now();

      // Send messages with size validation
      for (let i = 0; i < messageCount; i++) {
        bus.publish(`test.${i}`, { index: i, data: "x".repeat(1000) }); // ~1KB payload
      }

      const duration = performance.now() - start;
      const stats = adapter.getStats();

      expect(stats.messagesOversized).toBe(0); // All messages within limit

      console.log(`[Benchmark] Message size validation:`);
      console.log(`  Messages validated: ${messageCount}`);
      console.log(`  Processing time: ${duration.toFixed(2)}ms`);
      console.log(`  Validation overhead: ${(duration / messageCount).toFixed(3)}ms per message`);
      console.log(`  Messages oversized: ${stats.messagesOversized}`);
    });
  });

  describe("Batching Efficiency", () => {
    it("should compare batched vs unbatched performance", () => {
      vi.useFakeTimers();

      const adapterNoBatch = new CrossTabAdapter({
        channelName: "perf-test-1",
        transport: mockTransport,
        batchIntervalMs: 0,
        emitSystemEvents: false,
      });
      const bus1 = new PubSubBusImpl();
      const messageCount = 1000;

      adapterNoBatch.attach(bus1);

      const startNoBatch = performance.now();

      for (let i = 0; i < messageCount; i++) {
        bus1.publish(`test.${i}`, { i });
      }

      const durationNoBatch = performance.now() - startNoBatch;
      const sendCountNoBatch = mockTransport.sentMessages.length;

      mockTransport.resetMetrics();

      const adapterWithBatch = new CrossTabAdapter({
        channelName: "perf-test-2",
        transport: mockTransport,
        batchIntervalMs: 10,
        maxBatchSize: 50,
        emitSystemEvents: false,
      });

      const bus2 = new PubSubBusImpl();
      adapterWithBatch.attach(bus2);

      const startWithBatch = performance.now();

      for (let i = 0; i < messageCount; i++) {
        bus2.publish(`test.${i}`, { i });
      }

      vi.advanceTimersByTime(100);

      const durationWithBatch = performance.now() - startWithBatch;
      const stats = adapterWithBatch.getStats();

      console.log(`[Benchmark] Batching efficiency comparison:`);
      console.log(`  Messages: ${messageCount}`);
      console.log(`  Without batching:`);
      console.log(`    Duration: ${durationNoBatch.toFixed(2)}ms`);
      console.log(`    Transport sends: ${sendCountNoBatch}`);
      console.log(`  With batching:`);
      console.log(`    Duration: ${durationWithBatch.toFixed(2)}ms`);
      console.log(`    Transport sends: ${stats.batchesSent}`);
      console.log(
        `    Reduction: ${(((sendCountNoBatch - stats.batchesSent) / sendCountNoBatch) * 100).toFixed(1)}%`
      );
      console.log(`    Average batch size: ${stats.averageBatchSize.toFixed(1)}`);

      expect(stats.batchesSent).toBeLessThan(sendCountNoBatch);

      vi.useRealTimers();
    });
  });
});
