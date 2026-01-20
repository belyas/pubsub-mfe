import type { CrossTabEnvelope, DedupeKey } from "./types";

/**
 * Create a deduplication key from messageId and clientId.
 *
 * @param messageId - Message identifier
 * @param clientId - Client/tab identifier
 *
 * @returns Deduplication key in format "messageId:clientId"
 *
 * @example
 * ```ts
 * const key = createDedupeKey('msg-123', 'client-abc');
 * // => "msg-123:client-abc"
 * ```
 */
export function createDedupeKey(messageId: string, clientId: string): DedupeKey {
  return `${messageId}:${clientId}`;
}

/**
 * Configuration for the deduplication cache.
 */
export interface DeduplicationConfig {
  /**
   * Maximum number of message IDs to track.
   * Oldest entries are evicted when limit is reached.
   *
   * @default 1000
   */
  maxEntries?: number;

  /**
   * Maximum age of tracked messages in milliseconds.
   * Messages older than this are considered expired.
   *
   * @default 60000 (60 seconds)
   */
  maxAgeMs?: number;

  /**
   * Optional callback for debugging/monitoring duplicate detections.
   */
  onDuplicate?: (envelope: CrossTabEnvelope) => void;
}

/**
 * Entry in the deduplication cache.
 */
interface CacheEntry {
  /** Deduplication key (messageId:clientId) */
  key: string;
  /** Timestamp when the message was first seen */
  timestamp: number;
}

/**
 * LRU cache for message deduplication.
 *
 * Tracks recently seen messages to prevent duplicate processing.
 * Automatically evicts old entries based on size and time constraints.
 *
 * @example
 * ```ts
 * const cache = new DeduplicationCache({ maxEntries: 1000, maxAgeMs: 60000 });
 *
 * if (cache.isDuplicate(envelope)) {
 *   console.log('Duplicate message, skipping');
 *   return;
 * }
 *
 * cache.markAsSeen(envelope);
 * // Process message...
 * ```
 */
export class DeduplicationCache {
  private readonly maxEntries: number;
  private readonly maxAgeMs: number;
  private readonly onDuplicate?: (envelope: CrossTabEnvelope) => void;

  /** Map: dedupeKey -> CacheEntry */
  private readonly cache: Map<string, CacheEntry>;

  /** Timestamp of last cleanup run */
  private lastCleanup: number;

  /** Cleanup interval in milliseconds */
  private readonly cleanupInterval: number;

  constructor(config: DeduplicationConfig = {}) {
    this.maxEntries = config.maxEntries ?? 1000;
    this.maxAgeMs = config.maxAgeMs ?? 60000; // 60 seconds
    this.onDuplicate = config.onDuplicate;

    this.cache = new Map();
    this.lastCleanup = Date.now();
    this.cleanupInterval = Math.min(this.maxAgeMs / 2, 30000); // Max 30s
  }

  /**
   * Check if a message has been seen before (is a duplicate).
   *
   * This method does NOT mark the message as seen - use markAsSeen() for that.
   *
   * @param envelope - Message envelope to check
   * @returns true if message is a duplicate, false otherwise
   *
   * @example
   * ```ts
   * if (cache.isDuplicate(envelope)) {
   *   return; // Skip processing
   * }
   * cache.markAsSeen(envelope);
   * ```
   */
  isDuplicate(envelope: CrossTabEnvelope): boolean {
    const key = createDedupeKey(envelope.messageId, envelope.clientId);
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    const age = Date.now() - entry.timestamp;

    if (age > this.maxAgeMs) {
      this.cache.delete(key);
      return false;
    }

    if (this.onDuplicate) {
      try {
        this.onDuplicate(envelope);
      } catch {
        // Ignore callback errors
      }
    }

    return true;
  }

  /**
   * Mark a message as seen (add to cache).
   *
   * Updates LRU order and triggers cleanup if needed.
   *
   * @param envelope - Message envelope to mark as seen
   *
   * @example
   * ```ts
   * if (!cache.isDuplicate(envelope)) {
   *   cache.markAsSeen(envelope);
   *   processMessage(envelope);
   * }
   * ```
   */
  markAsSeen(envelope: CrossTabEnvelope): void {
    const key = createDedupeKey(envelope.messageId, envelope.clientId);
    const now = Date.now();

    // Delete and re-add to move to end of Map (LRU behavior)
    // Map maintains insertion order, so deleting and re-adding moves it to the end
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this.cache.set(key, {
      key,
      timestamp: now,
    });

    if (this.cache.size > this.maxEntries) {
      this.evictOldest();
    }

    if (now - this.lastCleanup > this.cleanupInterval) {
      this.cleanup();
      this.lastCleanup = now;
    }
  }

  /**
   * Check and mark a message in a single operation.
   *
   * Returns true if message is NOT a duplicate (and marks it as seen).
   * Returns false if message IS a duplicate (does not modify cache).
   *
   * @param envelope - Message envelope to check and mark
   *
   * @returns true if message should be processed, false if it's a duplicate
   *
   * @example
   * ```ts
   * if (cache.checkAndMark(envelope)) {
   *   processMessage(envelope);
   * }
   * ```
   */
  checkAndMark(envelope: CrossTabEnvelope): boolean {
    if (this.isDuplicate(envelope)) {
      return false;
    }

    this.markAsSeen(envelope);
    return true;
  }

  /**
   * Clear all entries from the cache.
   *
   * Useful for testing or resetting state.
   *
   * @example
   * ```ts
   * cache.clear();
   * ```
   */
  clear(): void {
    this.cache.clear();
    this.lastCleanup = Date.now();
  }

  /**
   * Get current cache statistics.
   *
   * @returns Cache statistics object
   *
   * @example
   * ```ts
   * const stats = cache.getStats();
   * console.log(`Cache size: ${stats.size}/${stats.maxEntries}`);
   * ```
   */
  getStats(): {
    size: number;
    maxEntries: number;
    maxAgeMs: number;
    oldestEntry: number | null;
  } {
    let oldestTimestamp: number | null = null;

    for (const entry of this.cache.values()) {
      if (oldestTimestamp === null || entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
      }
    }

    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      maxAgeMs: this.maxAgeMs,
      oldestEntry: oldestTimestamp,
    };
  }

  /**
   * Evict the oldest entry from the cache.
   *
   * Map iteration order is insertion order, so first entry is oldest.
   *
   * @private
   */
  private evictOldest(): void {
    const firstKey = this.cache.keys().next().value;

    if (firstKey) {
      this.cache.delete(firstKey);
    }
  }

  /**
   * Remove expired entries from the cache.
   *
   * Called periodically to prevent memory leaks.
   *
   * @private
   */
  private cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;

      if (age > this.maxAgeMs) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.cache.delete(key);
    }
  }
}

/**
 * Create a deduplication cache with the given configuration.
 *
 * Convenience factory function.
 *
 * @param config - Cache configuration
 *
 * @returns A new DeduplicationCache instance
 *
 * @example
 * ```ts
 * const cache = createDeduplicationCache({
 *   maxEntries: 500,
 *   maxAgeMs: 30000,
 *   onDuplicate: (envelope) => console.log('Duplicate:', envelope.messageId)
 * });
 * ```
 */
export function createDeduplicationCache(config?: DeduplicationConfig): DeduplicationCache {
  return new DeduplicationCache(config);
}
