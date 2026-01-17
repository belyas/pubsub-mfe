import type { CrossTabEnvelope } from "./types";

/**
 * Batching configuration.
 */
export interface BatchingConfig {
  /**
   * Batch interval in milliseconds.
   * Messages published within this window are batched together.
   */
  intervalMs: number;

  /**
   * Maximum batch size (number of messages).
   * If batch reaches this size, it's flushed immediately.
   * Default: 50
   */
  maxBatchSize?: number;

  /**
   * Enable debug logging.
   */
  debug?: boolean;
}

/**
 * Batching configuration with flush callback.
 */
export interface BatchingConfigWithFlush extends BatchingConfig {
  /**
   * Callback invoked when a batch is flushed.
   */
  onFlush: (messages: CrossTabEnvelope[]) => void;
}

/**
 * Message batcher that accumulates messages and flushes them periodically.
 *
 * Uses a time-based batching strategy:
 * - Messages are accumulated in a buffer
 * - Buffer is flushed after intervalMs
 * - Buffer is also flushed if maxBatchSize is reached
 * - Flushes on dispose for cleanup
 *
 * @example
 * ```ts
 * const batcher = new MessageBatcher({
 *   intervalMs: 10,
 *   maxBatchSize: 50,
 *   onFlush: (messages) => {
 *     transport.send(messages);
 *   },
 * });
 *
 * batcher.add(envelope1);
 * batcher.add(envelope2);
 * // Both sent together after 10ms or when batch reaches 50
 *
 * batcher.dispose();
 * ```
 */
export class MessageBatcher {
  private readonly config: Required<BatchingConfig>;
  private readonly onFlush: (messages: CrossTabEnvelope[]) => void;
  private buffer: CrossTabEnvelope[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private stats = {
    totalMessages: 0,
    totalBatches: 0,
    totalFlushes: 0,
    maxBatchSize: 0,
  };

  constructor(config: BatchingConfigWithFlush) {
    this.config = {
      intervalMs: config.intervalMs,
      maxBatchSize: config.maxBatchSize ?? 50,
      debug: config.debug ?? false,
    };
    this.onFlush = config.onFlush;
  }

  /**
   * Add a message to the batch.
   *
   * If this causes the batch to reach maxBatchSize, flushes immediately.
   * Otherwise, schedules a flush after intervalMs.
   */
  add(envelope: CrossTabEnvelope): void {
    if (this.disposed) {
      throw new Error("MessageBatcher is disposed");
    }

    this.buffer.push(envelope);
    this.stats.totalMessages++;

    if (this.config.debug) {
      console.log("[MessageBatcher] Message added", {
        messageId: envelope.messageId,
        bufferSize: this.buffer.length,
      });
    }

    if (this.buffer.length >= this.config.maxBatchSize) {
      if (this.config.debug) {
        console.log("[MessageBatcher] Batch full, flushing immediately", {
          batchSize: this.buffer.length,
        });
      }

      this.flush();
      return;
    }

    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.flush();
      }, this.config.intervalMs);
    }
  }

  /**
   * Flush all buffered messages immediately.
   */
  flush(): void {
    if (this.buffer.length === 0) {
      return;
    }

    const messages = this.buffer;
    this.buffer = [];

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.stats.totalBatches++;
    this.stats.totalFlushes++;
    this.stats.maxBatchSize = Math.max(this.stats.maxBatchSize, messages.length);

    if (this.config.debug) {
      console.log("[MessageBatcher] Flushing batch", {
        batchSize: messages.length,
        totalBatches: this.stats.totalBatches,
      });
    }

    this.onFlush(messages);
  }

  /**
   * Get batching statistics.
   */
  getStats() {
    return {
      totalMessages: this.stats.totalMessages,
      totalBatches: this.stats.totalBatches,
      totalFlushes: this.stats.totalFlushes,
      maxBatchSize: this.stats.maxBatchSize,
      currentBufferSize: this.buffer.length,
      averageBatchSize:
        this.stats.totalBatches > 0 ? this.stats.totalMessages / this.stats.totalBatches : 0,
    };
  }

  /**
   * Dispose the batcher, flushing any remaining messages.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.flush();

    if (this.config.debug) {
      console.log("[MessageBatcher] Disposed", this.getStats());
    }
  }

  /**
   * Check if the batcher is disposed.
   */
  isDisposed(): boolean {
    return this.disposed;
  }
}

/**
 * Create a message batcher with configuration.
 *
 * @param config - Batching configuration
 * @returns MessageBatcher instance
 */
export function createMessageBatcher(
  config: BatchingConfig & { onFlush: (messages: CrossTabEnvelope[]) => void }
): MessageBatcher {
  return new MessageBatcher(config);
}
