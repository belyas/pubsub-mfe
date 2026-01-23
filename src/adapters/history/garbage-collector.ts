import type { HistoryStorage, GarbageCollectionResult, ResolvedHistoryConfig } from "./types";

/**
 * Hybrid garbage collector for message history.
 *
 * Strategy:
 * 1. Lightweight check on every write (only checks count, skips if under threshold)
 * 2. Periodic full GC (runs at configured interval)
 *
 * GC removes messages based on:
 * - TTL expiration (messages older than ttlSeconds)
 * - Overflow (messages exceeding maxMessages, oldest first)
 */
export class GarbageCollector {
  private readonly storage: HistoryStorage;
  private readonly config: ResolvedHistoryConfig;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastFullGcTimestamp: number = 0;
  private running = false;
  private totalExpiredRemoved = 0;
  private totalOverflowRemoved = 0;
  private cyclesCompleted = 0;

  // Threshold for lightweight check (skip full GC if under this ratio)
  private readonly OVERFLOW_THRESHOLD_RATIO = 0.9;

  constructor(storage: HistoryStorage, config: ResolvedHistoryConfig) {
    this.storage = storage;
    this.config = config;
  }

  /**
   * Start the periodic GC timer.
   */
  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      this.runFullGc().catch((error) => {
        this.log("error", "Periodic GC failed", error);
        this.config.onError?.(error as Error);
      });
    }, this.config.gcIntervalMs);

    this.log("debug", "GC started", { intervalMs: this.config.gcIntervalMs });
  }

  /**
   * Stop the periodic GC timer.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.log("debug", "GC stopped");
  }

  /**
   * Lightweight check called on every write.
   * Only triggers GC if storage is near capacity.
   *
   * @returns true if GC was triggered, false otherwise
   */
  async checkOnWrite(): Promise<boolean> {
    if (this.running) {
      return false;
    }

    try {
      const count = await this.storage.count(this.config.namespace);
      const threshold = Math.floor(this.config.maxMessages * this.OVERFLOW_THRESHOLD_RATIO);

      if (count >= threshold) {
        this.log("debug", "Write check triggered GC", { count, threshold });
        await this.runFullGc();
        return true;
      }

      return false;
    } catch (error) {
      this.log("error", "Write check failed", error);
      this.config.onError?.(error as Error);
      return false;
    }
  }

  /**
   * Run a full garbage collection cycle.
   *
   * @returns Result with counts of removed messages
   */
  async runFullGc(): Promise<GarbageCollectionResult> {
    if (this.running) {
      return {
        expiredRemoved: 0,
        overflowRemoved: 0,
        totalRemoved: 0,
        durationMs: 0,
      };
    }

    this.running = true;
    const startTime = performance.now();

    try {
      // Phase 1: Remove TTL-expired messages
      const expiredRemoved = await this.removeExpired();
      // Phase 2: Remove overflow (oldest messages exceeding maxMessages)
      const overflowRemoved = await this.removeOverflow();
      const durationMs = performance.now() - startTime;
      const totalRemoved = expiredRemoved + overflowRemoved;
      // Update stats
      this.totalExpiredRemoved += expiredRemoved;
      this.totalOverflowRemoved += overflowRemoved;
      this.cyclesCompleted++;
      this.lastFullGcTimestamp = Date.now();

      this.log("debug", "GC cycle completed", {
        expiredRemoved,
        overflowRemoved,
        totalRemoved,
        durationMs,
      });

      return {
        expiredRemoved,
        overflowRemoved,
        totalRemoved,
        durationMs,
      };
    } finally {
      this.running = false;
    }
  }

  /**
   * Get GC statistics.
   */
  getStats(): {
    totalExpiredRemoved: number;
    totalOverflowRemoved: number;
    cyclesCompleted: number;
    lastFullGcTimestamp: number | null;
  } {
    return {
      totalExpiredRemoved: this.totalExpiredRemoved,
      totalOverflowRemoved: this.totalOverflowRemoved,
      cyclesCompleted: this.cyclesCompleted,
      lastFullGcTimestamp: this.lastFullGcTimestamp || null,
    };
  }

  /**
   * Remove messages older than TTL.
   */
  private async removeExpired(): Promise<number> {
    if (this.config.ttlSeconds <= 0) {
      return 0;
    }

    const cutoffTimestamp = Date.now() - this.config.ttlSeconds * 1000;
    const expired = await this.storage.getExpired(this.config.namespace, cutoffTimestamp);

    if (expired.length === 0) {
      return 0;
    }

    const ids = expired.map((r) => r.id);
    await this.storage.deleteMany(ids);

    this.log("debug", "Removed expired messages", {
      count: ids.length,
      cutoffTimestamp,
    });

    return ids.length;
  }

  /**
   * Remove oldest messages that exceed maxMessages limit.
   */
  private async removeOverflow(): Promise<number> {
    const count = await this.storage.count(this.config.namespace);

    if (count <= this.config.maxMessages) {
      return 0;
    }

    const excess = count - this.config.maxMessages;
    const oldest = await this.storage.getOldest(this.config.namespace, excess);

    if (oldest.length === 0) {
      return 0;
    }

    const ids = oldest.map((r) => r.id);
    await this.storage.deleteMany(ids);

    this.log("debug", "Removed overflow messages", {
      count: ids.length,
      totalCount: count,
      maxMessages: this.config.maxMessages,
    });

    return ids.length;
  }

  private log(level: "debug" | "error", message: string, data?: unknown): void {
    if (!this.config.debug && level === "debug") {
      return;
    }

    const prefix = `[HistoryGC][${this.config.namespace}]`;

    if (level === "error") {
      console.error(`${prefix} ${message}`, data ?? "");
    } else {
      console.debug(`${prefix} ${message}`, data ?? "");
    }
  }
}

/**
 * Create a new garbage collector instance.
 *
 * @param storage - Storage instance
 * @param config - Resolved configuration
 * @returns GarbageCollector instance
 */
export function createGarbageCollector(
  storage: HistoryStorage,
  config: ResolvedHistoryConfig
): GarbageCollector {
  return new GarbageCollector(storage, config);
}
