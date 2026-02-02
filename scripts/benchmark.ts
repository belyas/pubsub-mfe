#!/usr/bin/env node

/**
 * Performance Benchmark Suite
 * 
 * Measures:
 * - Throughput (messages per second)
 * - Latency (p50, p95, p99)
 * - Memory usage and garbage collection impact
 * - Batching efficiency
 * - Topic matching performance
 * - Schema validation overhead
 */

import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { createPubSub } from '../src/bus.js';
import { matchTopic, compileMatcher } from '../src/topic-matcher.js';
import type { Message } from '../src/types.js';

// Type augmentations for Node.js
declare const global: typeof globalThis & {
  gc?: () => void;
};

interface BenchmarkResult {
  name: string;
  throughput?: number; // msgs/sec
  latency?: {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
  };
  memory?: {
    heapUsedMB: number;
    heapTotalMB: number;
    externalMB: number; // Memory used by C++ objects bound to JS
  };
  duration: number; // ms
  operations: number;
  metadata?: Record<string, any>;
}

function formatNumber(num: number): string {
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}

function calculatePercentile(values: number[], percentile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor(sorted.length * percentile);
  return sorted[index] || 0;
}

function calculateStats(values: number[]): BenchmarkResult['latency'] {
  if (values.length === 0) return { avg: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0 };
  
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  
  return {
    avg: sum / sorted.length,
    p50: calculatePercentile(sorted, 0.50),
    p95: calculatePercentile(sorted, 0.95),
    p99: calculatePercentile(sorted, 0.99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function getMemoryUsage() {
  const mem = process.memoryUsage();

  return {
    heapUsedMB: parseFloat(formatMB(mem.heapUsed)),
    heapTotalMB: parseFloat(formatMB(mem.heapTotal)),
    externalMB: parseFloat(formatMB(mem.external)),
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => globalThis.queueMicrotask(resolve));
}

async function benchmarkBasicThroughput(): Promise<BenchmarkResult> {
  const bus = createPubSub({ app: 'benchmark' });
  const messageCount = 100_000;
  let received = 0;

  bus.subscribe('test.message', () => {
    received++;
  });

  const start = performance.now();
  
  for (let i = 0; i < messageCount; i++) {
    bus.publish('test.message', { index: i });
  }

  await flushMicrotasks();
  
  const duration = performance.now() - start;
  const throughput = (messageCount / duration) * 1000;

  bus.dispose();

  return {
    name: 'Basic Pub/Sub Throughput',
    throughput,
    duration,
    operations: messageCount,
    metadata: {
      messagesPublished: messageCount,
      messagesReceived: received,
    },
  };
}

async function benchmarkWildcardThroughput(): Promise<BenchmarkResult> {
  const bus = createPubSub({ app: 'benchmark' });
  const messageCount = 50_000;
  let received = 0;

  bus.subscribe('user.+.updated', () => received++);
  bus.subscribe('order.#', () => received++);
  bus.subscribe('cart.+.item.+', () => received++);

  const start = performance.now();

  for (let i = 0; i < messageCount / 4; i++) {
    bus.publish(`user.${i}.updated`, { userId: i });
    bus.publish(`order.${i}.created`, { orderId: i });
    bus.publish(`order.${i}.fulfilled.shipped`, { orderId: i });
    bus.publish(`cart.${i}.item.add`, { itemId: i });
  }

  await flushMicrotasks();
  
  const duration = performance.now() - start;
  const throughput = (messageCount / duration) * 1000;

  bus.dispose();

  return {
    name: 'Wildcard Pattern Throughput',
    throughput,
    duration,
    operations: messageCount,
    metadata: {
      messagesPublished: messageCount,
      messagesReceived: received,
      subscribersCount: 3,
    },
  };
}

async function benchmarkLatency(): Promise<BenchmarkResult> {
  const bus = createPubSub({ app: 'benchmark' });
  const messageCount = 10_000;
  const latencies: number[] = [];

  bus.subscribe('test.latency', () => {
    const now = performance.now();
    const sentAt = latencies[latencies.length - 1];
    latencies[latencies.length - 1] = now - sentAt;
  });

  const start = performance.now();

  for (let i = 0; i < messageCount; i++) {
    const sentAt = performance.now();
    latencies.push(sentAt);
    bus.publish('test.latency', { index: i });
  }

  await flushMicrotasks();
  
  const duration = performance.now() - start;
  const throughput = (messageCount / duration) * 1000;

  bus.dispose();

  return {
    name: 'End-to-End Latency',
    throughput,
    latency: calculateStats(latencies),
    duration,
    operations: messageCount,
  };
}

async function benchmarkMultipleSubscribers(): Promise<BenchmarkResult> {
  const bus = createPubSub({ app: 'benchmark' });
  const messageCount = 50_000;
  const subscriberCount = 10;
  let totalReceived = 0;

  for (let i = 0; i < subscriberCount; i++) {
    bus.subscribe('broadcast.message', () => {
      totalReceived++;
    });
  }

  const start = performance.now();
  
  for (let i = 0; i < messageCount; i++) {
    bus.publish('broadcast.message', { index: i });
  }

  await flushMicrotasks();
  
  const duration = performance.now() - start;
  const throughput = (messageCount / duration) * 1000;

  bus.dispose();

  return {
    name: 'Multiple Subscribers (Broadcast)',
    throughput,
    duration,
    operations: messageCount,
    metadata: {
      subscriberCount,
      totalReceived,
      messagesPerSubscriber: totalReceived / subscriberCount,
    },
  };
}

function benchmarkTopicMatching(): BenchmarkResult {
  const patterns = [
    'user.+.updated',
    'order.#',
    'cart.+.item.+',
    'notification.+.email.#',
    'analytics.+.+.tracked',
  ];

  const topics = [
    'user.123.updated',
    'user.456.profile.updated',
    'order.789.created',
    'order.101.fulfilled.shipped.delivered',
    'cart.abc.item.add',
    'cart.def.item.remove',
    'notification.user.email.sent',
    'notification.admin.email.sent.confirmed',
    'analytics.page.view.tracked',
    'analytics.button.click.tracked',
  ];

  // Pre-compile matchers
  const compiledMatchers = patterns.map(pattern => compileMatcher(pattern));

  const iterations = 100_000;
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    for (const topic of topics) {
      for (const matcher of compiledMatchers) {
        matchTopic(topic, matcher);
      }
    }
  }

  const duration = performance.now() - start;
  const operations = iterations * topics.length * patterns.length;
  const throughput = (operations / duration) * 1000;

  return {
    name: 'Topic Pattern Matching',
    throughput,
    duration,
    operations,
    metadata: {
      patterns: patterns.length,
      topics: topics.length,
      iterations,
    },
  };
}

async function benchmarkMemoryUsage(): Promise<BenchmarkResult> {
  // Force GC if available
  if (global.gc) {
    global.gc();
  }
  await sleep(100);

  const memBefore = getMemoryUsage();
  const bus = createPubSub({ app: 'benchmark' });
  const messageCount = 100_000;
  const messages: Message[] = [];

  // Subscribe and collect messages
  bus.subscribe('#', (msg) => {
    messages.push(msg);
  });

  const start = performance.now();

  for (let i = 0; i < messageCount; i++) {
    bus.publish(`test.${i % 100}`, {
      index: i,
      data: 'x'.repeat(100),
      timestamp: Date.now(),
    });
  }

  await flushMicrotasks();
  
  const duration = performance.now() - start;
  const memAfter = getMemoryUsage();

  bus.dispose();

  // Force GC again
  if (global.gc) {
    global.gc();
  }
  await sleep(100);

  const memAfterGC = getMemoryUsage();

  return {
    name: 'Memory Usage (100k messages)',
    duration,
    operations: messageCount,
    memory: memAfter,
    metadata: {
      heapUsedBeforeMB: memBefore.heapUsedMB,
      heapUsedAfterMB: memAfter.heapUsedMB,
      heapUsedAfterGCMB: memAfterGC.heapUsedMB,
      heapGrowthMB: memAfter.heapUsedMB - memBefore.heapUsedMB,
      heapReclaimedByGCMB: memAfter.heapUsedMB - memAfterGC.heapUsedMB,
      messagesStored: messages.length,
      avgMessageSizeBytes: ((memAfter.heapUsedMB - memBefore.heapUsedMB) * 1024 * 1024) / messages.length,
    },
  };
}

async function benchmarkMemoryLeak(): Promise<BenchmarkResult> {
  if (global.gc) {
    global.gc();
  }
  await sleep(100);

  const memBefore = getMemoryUsage();
  const iterations = 10;
  const messagesPerIteration = 10_000;
  const memorySnapshots: number[] = [];

  const start = performance.now();

  for (let iter = 0; iter < iterations; iter++) {
    const bus = createPubSub({ app: 'benchmark' });
    
    bus.subscribe('#', () => {
      // Consume messages
    });

    for (let i = 0; i < messagesPerIteration; i++) {
      bus.publish('test', { data: 'x'.repeat(100) });
    }

    await flushMicrotasks();
    bus.dispose();

    if (global.gc) {
      global.gc();
    }
    
    await sleep(10);
    memorySnapshots.push(process.memoryUsage().heapUsed);
  }

  const duration = performance.now() - start;
  const memAfter = getMemoryUsage();

  // Check if memory is growing linearly (leak) or stable
  const firstSnapshot = memorySnapshots[0];
  const lastSnapshot = memorySnapshots[memorySnapshots.length - 1];
  const memoryGrowth = lastSnapshot - firstSnapshot;
  const avgGrowthPerIteration = memoryGrowth / iterations;

  return {
    name: 'Memory Leak Detection',
    duration,
    operations: iterations * messagesPerIteration,
    memory: memAfter,
    metadata: {
      iterations,
      messagesPerIteration,
      heapUsedBeforeMB: memBefore.heapUsedMB,
      heapUsedAfterMB: memAfter.heapUsedMB,
      memoryGrowthMB: formatMB(memoryGrowth),
      avgGrowthPerIterationMB: formatMB(avgGrowthPerIteration),
      leakDetected: avgGrowthPerIteration > 1024 * 1024, // > 1MB per iteration is suspicious
    },
  };
}

async function benchmarkSchemaValidation(): Promise<BenchmarkResult> {
  const bus = createPubSub({ app: 'benchmark' });
  const messageCount = 50_000;
  let validMessages = 0;
  let invalidMessages = 0;

  const schema = {
    type: 'object' as const,
    properties: {
      userId: { type: 'number' as const },
      email: { type: 'string' as const },
      age: { type: 'number' as const },
    },
    required: ['userId', 'email'],
  };

  // Register schema with correct signature: registerSchema(schemaVersion, schema)
  bus.registerSchema('user.created@1.0.0', schema);

  bus.subscribe('user.created', () => {
    validMessages++;
  });

  bus.subscribe('system.validation.error', () => {
    invalidMessages++;
  });

  const start = performance.now();

  // Publish mix of valid and invalid messages
  for (let i = 0; i < messageCount; i++) {
    const isValid = i % 4 !== 0; // 75% valid, 25% invalid
    
    if (isValid) {
      bus.publish('user.created', {
        userId: i,
        email: `user${i}@example.com`,
        age: 20 + (i % 50),
      });
    } else {
      bus.publish('user.created', {
        userId: i,
        // Missing email - should fail validation
        age: 'invalid', // Wrong type
      } as any);
    }
  }

  await flushMicrotasks();
  
  const duration = performance.now() - start;
  const throughput = (messageCount / duration) * 1000;

  bus.dispose();

  return {
    name: 'Schema Validation Overhead',
    throughput,
    duration,
    operations: messageCount,
    metadata: {
      validMessages,
      invalidMessages,
      validationRate: (validMessages + invalidMessages) / messageCount,
      validationOverheadMs: duration / messageCount,
    },
  };
}

async function benchmarkRetentionBuffer(): Promise<BenchmarkResult> {
  const bus = createPubSub({
    app: 'benchmark',
    retention: {
      maxMessages: 1000,
      ttlMs: 60000,
    },
  });

  const messageCount = 10_000;
  const start = performance.now();

  for (let i = 0; i < messageCount; i++) {
    bus.publish('test.retained', {
      index: i,
      data: 'x'.repeat(50),
    });
  }

  await flushMicrotasks();
  
  const duration = performance.now() - start;
  const throughput = (messageCount / duration) * 1000;

  // Test replay performance
  let replayedCount = 0;
  const replayStart = performance.now();
  
  bus.subscribe('test.retained', () => {
    replayedCount++;
  }, { replay: 1000 }); // Replay last 1000 messages

  await flushMicrotasks();
  
  const replayDuration = performance.now() - replayStart;

  bus.dispose();

  return {
    name: 'Retention Buffer (1k limit)',
    throughput,
    duration,
    operations: messageCount,
    metadata: {
      messagesPublished: messageCount,
      messagesRetained: Math.min(1000, messageCount),
      messagesReplayed: replayedCount,
      replayDurationMs: replayDuration,
      retentionOverheadMs: duration / messageCount,
    },
  };
}

async function benchmarkRateLimiting(): Promise<BenchmarkResult> {
  const bus = createPubSub({
    app: 'benchmark',
    rateLimit: {
      maxPerSecond: 1000,
      maxBurst: 100,
    },
  });

  const messageCount = 2000; // Exceeds rate limit
  let receivedCount = 0;
  let rateLimitedCount = 0;

  bus.subscribe('test.message', () => {
    receivedCount++;
  });

  bus.subscribe('system.rate.limited', () => {
    rateLimitedCount++;
  });

  const start = performance.now();

  for (let i = 0; i < messageCount; i++) {
    bus.publish('test.message', { index: i });
  }

  await flushMicrotasks();
  
  const duration = performance.now() - start;
  const throughput = (messageCount / duration) * 1000;

  bus.dispose();

  return {
    name: 'Rate Limiting (1k/sec)',
    throughput,
    duration,
    operations: messageCount,
    metadata: {
      messagesAttempted: messageCount,
      messagesReceived: receivedCount,
      messagesRateLimited: rateLimitedCount,
      rateLimitEfficiency: rateLimitedCount / messageCount,
      rateLimitOverheadMs: duration / messageCount,
    },
  };
}

async function benchmarkHighLoadStress(): Promise<BenchmarkResult> {
  const bus = createPubSub({ app: 'benchmark' });
  const subscriberCount = 100;
  const topicCount = 50;
  const messagesPerTopic = 1000;
  let totalReceived = 0;

  // Create many subscribers on various patterns
  for (let i = 0; i < subscriberCount; i++) {
    const pattern = i % 2 === 0 ? `topic.${i % topicCount}.#` : `topic.+.event`;
    bus.subscribe(pattern, () => {
      totalReceived++;
    });
  }

  const start = performance.now();

  // Publish to many topics
  for (let t = 0; t < topicCount; t++) {
    for (let m = 0; m < messagesPerTopic; m++) {
      bus.publish(`topic.${t}.event`, {
        topicIndex: t,
        messageIndex: m,
      });
    }
  }

  await flushMicrotasks();
  
  const duration = performance.now() - start;
  const totalMessages = topicCount * messagesPerTopic;
  const throughput = (totalMessages / duration) * 1000;

  bus.dispose();

  return {
    name: 'High Load Stress Test',
    throughput,
    duration,
    operations: totalMessages,
    metadata: {
      subscriberCount,
      topicCount,
      messagesPerTopic,
      totalMessages,
      totalReceived,
      avgDeliveryPerMessage: totalReceived / totalMessages,
    },
  };
}

function printResult(result: BenchmarkResult): void {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 ${result.name}`);
  console.log('='.repeat(80));
  
  if (result.throughput) {
    console.log(`Throughput:     ${formatNumber(result.throughput)} msgs/sec`);
  }
  
  console.log(`Duration:       ${formatNumber(result.duration)} ms`);
  console.log(`Operations:     ${formatNumber(result.operations)}`);
  
  if (result.latency) {
    console.log(`\nLatency:`);
    console.log(`  Average:      ${result.latency.avg.toFixed(4)} ms`);
    console.log(`  P50:          ${result.latency.p50.toFixed(4)} ms`);
    console.log(`  P95:          ${result.latency.p95.toFixed(4)} ms`);
    console.log(`  P99:          ${result.latency.p99.toFixed(4)} ms`);
    console.log(`  Min:          ${result.latency.min.toFixed(4)} ms`);
    console.log(`  Max:          ${result.latency.max.toFixed(4)} ms`);
  }
  
  if (result.memory) {
    console.log(`\nMemory:`);
    console.log(`  Heap Used:    ${result.memory.heapUsedMB} MB`);
    console.log(`  Heap Total:   ${result.memory.heapTotalMB} MB`);
    console.log(`  External:     ${result.memory.externalMB} MB`);
  }
  
  if (result.metadata) {
    console.log(`\nMetadata:`);
    for (const [key, value] of Object.entries(result.metadata)) {
      console.log(`  ${key}: ${typeof value === 'number' ? formatNumber(value) : value}`);
    }
  }
}

function printSummary(results: BenchmarkResult[]): void {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📈 BENCHMARK SUMMARY`);
  console.log('='.repeat(80));
  
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const totalOps = results.reduce((sum, r) => sum + r.operations, 0);
  
  console.log(`\nTotal Duration:  ${formatNumber(totalDuration)} ms`);
  console.log(`Total Operations: ${formatNumber(totalOps)}`);
  console.log(`Test Suites:      ${results.length}`);
  
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`Throughput Rankings:`);
  console.log('─'.repeat(80));
  
  const withThroughput = results.filter(r => r.throughput);
  withThroughput.sort((a, b) => (b.throughput || 0) - (a.throughput || 0));
  
  withThroughput.forEach((result, index) => {
    const throughput = result.throughput || 0;
    const bar = '█'.repeat(Math.floor(throughput / (withThroughput[0].throughput || 1) * 40));
    console.log(`${index + 1}. ${result.name}`);
    console.log(`   ${formatNumber(throughput)} msgs/sec ${bar}`);
  });
  
  console.log(`\n✅ Benchmark suite completed successfully!\n`);
}

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   @belyas/pubsub-mfe Performance Benchmark Suite                          ║
║                                                                            ║
║   Measuring: Throughput, Latency, Memory Usage                            ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
`);

  const results: BenchmarkResult[] = [];

  try {
    // Core benchmarks
    console.log('\n🚀 Running Core Benchmarks...');
    results.push(await benchmarkBasicThroughput());
    results.push(await benchmarkWildcardThroughput());
    results.push(await benchmarkLatency());
    results.push(await benchmarkMultipleSubscribers());

    // Topic matching
    console.log('\n🔍 Running Topic Matching Benchmarks...');
    results.push(benchmarkTopicMatching());

    // Memory benchmarks
    console.log('\n💾 Running Memory Benchmarks...');
    results.push(await benchmarkMemoryUsage());
    results.push(await benchmarkMemoryLeak());

    // Feature benchmarks
    console.log('\n⚙️  Running Feature Benchmarks...');
    results.push(await benchmarkSchemaValidation());
    results.push(await benchmarkRetentionBuffer());
    results.push(await benchmarkRateLimiting());

    // Stress tests
    console.log('\n🔥 Running Stress Tests...');
    results.push(await benchmarkHighLoadStress());

    // Print all results
    results.forEach(printResult);
    
    // Print summary
    printSummary(results);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Benchmark failed:', error);
    process.exit(1);
  }
}

// Run with --expose-gc flag for accurate memory measurements
if (!global.gc) {
  console.warn('\n⚠️  Warning: Run with --expose-gc flag for accurate memory measurements');
  console.warn('   Example: node --expose-gc scripts/benchmark.ts\n');
}

main();
