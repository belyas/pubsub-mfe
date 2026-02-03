import type { PubSubBus, Message, Topic } from "../../types";
import type {
  HistoryAdapterConfig,
  HistoryAdapterStats,
  HistoryQueryOptions,
  ResolvedHistoryConfig,
  HistoryStorage,
  StoredMessage,
} from "./types";
import { createIndexedDBStorage } from "./storage";
import { GarbageCollector, createGarbageCollector } from "./garbage-collector";

const DEFAULT_DB_NAME = "pubsub-history";
const DEFAULT_NAMESPACE = "default";
const DEFAULT_MAX_MESSAGES = 1000;
const DEFAULT_TTL_SECONDS = 3600; // 1 hour
const DEFAULT_GC_INTERVAL_MS = 60000; // 1 minute

/**
 * History Adapter for persisting messages to IndexedDB.
 *
 * Features:
 * - Persists all published messages to IndexedDB
 * - Shared storage across all tabs (via IndexedDB)
 * - Supports wildcard topic queries
 * - Automatic garbage collection (TTL + max count)
 * - Deduplicates messages by ID
 *
 * Usage:
 * ```ts
 * const bus = createPubSub({ app: 'my-app' });
 * const historyAdapter = await createHistoryAdapter({
 *   maxMessages: 500,
 *   ttlSeconds: 1800,
 * });
 *
 * await historyAdapter.attach(bus);
 *
 * // Late joiner retrieves history
 * const history = await historyAdapter.getHistory('cart.#', { limit: 20 });
 *
 * // Cleanup
 * await historyAdapter.detach();
 * ```
 */
export class HistoryAdapter {
  private readonly config: ResolvedHistoryConfig;
  private readonly storage: HistoryStorage;
  private readonly gc: GarbageCollector;
  private bus: PubSubBus | null = null;
  private unsubscribeOnPublish?: () => void;
  private messagesPersisted = 0;
  private messagesRetrieved = 0;
  private duplicatesSkipped = 0;

  constructor(config: HistoryAdapterConfig = {}) {
    this.config = this.resolveConfig(config);
    this.storage = createIndexedDBStorage(this.config.dbName);
    this.gc = createGarbageCollector(this.storage, this.config);
  }

  /**
   * Ensure storage is open. Re-opens if previously closed.
   * This allows getHistory and other read operations to work
   * even after detach().
   */
  private async ensureStorageOpen(): Promise<void> {
    if (!this.storage.isOpen()) {
      await this.storage.open();
    }
  }

  /**
   * Attach the adapter to a PubSubBus instance.
   *
   * Opens IndexedDB, starts GC timer, and hooks into publish events.
   *
   * @param bus - The PubSubBus instance to attach to
   *
   * @throws Error if already attached to a bus
   */
  async attach(bus: PubSubBus): Promise<void> {
    if (this.bus) {
      throw new Error("HistoryAdapter is already attached to a bus");
    }

    await this.storage.open();

    this.bus = bus;
    const hooks = bus.getHooks();

    this.unsubscribeOnPublish = hooks.onPublish((message: Message) => {
      this.handlePublish(message).catch((error) => {
        this.log("error", "Failed to persist message", error);
        this.config.onError?.(error as Error);
      });
    });

    this.gc.start();

    this.log("debug", "Attached to bus", {
      namespace: this.config.namespace,
      maxMessages: this.config.maxMessages,
      ttlSeconds: this.config.ttlSeconds,
    });
  }

  /**
   * Detach the adapter from the bus.
   *
   * Stops GC timer and closes IndexedDB connection.
   */
  async detach(): Promise<void> {
    if (!this.bus) {
      return;
    }

    if (this.unsubscribeOnPublish) {
      this.unsubscribeOnPublish();
      this.unsubscribeOnPublish = undefined;
    }

    this.gc.stop();
    this.storage.close();

    this.bus = null;

    this.log("debug", "Detached from bus");
  }

  /**
   * Get message history for a topic pattern.
   *
   * Retrieves messages from IndexedDB (shared across all tabs).
   * Supports MQTT-style wildcards (+ and #).
   *
   * @param topic - Topic pattern (e.g., "cart.#", "user.+.login")
   * @param options - Query options (fromTime, limit)
   *
   * @returns Promise resolving to array of matching messages
   */
  async getHistory<T = unknown>(
    topic: Topic,
    options: HistoryQueryOptions = {}
  ): Promise<Message<T>[]> {
    await this.ensureStorageOpen();

    const records = await this.storage.query(this.config.namespace, topic, options);
    this.messagesRetrieved += records.length;

    // Extract the original messages from storage records
    return records.map((r) => r.message as Message<T>);
  }

  /**
   * Get current adapter statistics.
   */
  async getStats(): Promise<HistoryAdapterStats> {
    const gcStats = this.gc.getStats();
    let estimatedStorageCount = 0;

    try {
      await this.ensureStorageOpen();
      estimatedStorageCount = await this.storage.count(this.config.namespace);
    } catch {
      // Ignore count errors (e.g., if storage can't be opened)
    }

    return {
      messagesPersisted: this.messagesPersisted,
      messagesRetrieved: this.messagesRetrieved,
      messagesGarbageCollected: gcStats.totalExpiredRemoved + gcStats.totalOverflowRemoved,
      duplicatesSkipped: this.duplicatesSkipped,
      gcCyclesCompleted: gcStats.cyclesCompleted,
      estimatedStorageCount,
      lastGcTimestamp: gcStats.lastFullGcTimestamp,
      attached: this.bus !== null,
      namespace: this.config.namespace,
    };
  }

  /**
   * Clear all stored history for this namespace.
   * Use with caution!
   */
  async clearHistory(): Promise<void> {
    await this.ensureStorageOpen();
    await this.storage.clearNamespace(this.config.namespace);
    this.log("debug", "History cleared");
  }

  /**
   * Force a garbage collection cycle.
   * Normally GC runs automatically, but this can be called manually.
   */
  async forceGc(): Promise<void> {
    await this.ensureStorageOpen();
    await this.gc.runFullGc();
  }

  /**
   * Handle a published message by persisting to storage.
   */
  private async handlePublish(message: Message): Promise<void> {
    const now = Date.now();
    const record: StoredMessage = {
      id: message.id,
      topic: message.topic,
      timestamp: message.ts,
      namespace: this.config.namespace,
      message: message,
      createdAt: now,
    };

    const stored = await this.storage.put(record);

    if (stored) {
      this.messagesPersisted++;

      // Lightweight GC check on write
      await this.gc.checkOnWrite();

      this.log("debug", "Message persisted", {
        id: message.id,
        topic: message.topic,
      });
    } else {
      this.duplicatesSkipped++;
      this.log("debug", "Duplicate message skipped", { id: message.id });
    }
  }

  private resolveConfig(config: HistoryAdapterConfig): ResolvedHistoryConfig {
    return {
      dbName: config.dbName ?? DEFAULT_DB_NAME,
      namespace: config.namespace ?? DEFAULT_NAMESPACE,
      maxMessages: config.maxMessages ?? DEFAULT_MAX_MESSAGES,
      ttlSeconds: config.ttlSeconds ?? DEFAULT_TTL_SECONDS,
      gcIntervalMs: config.gcIntervalMs ?? DEFAULT_GC_INTERVAL_MS,
      debug: config.debug ?? false,
      onError: config.onError,
    };
  }

  private log(level: "debug" | "error", message: string, data?: unknown): void {
    if (!this.config.debug && level === "debug") {
      return;
    }

    const prefix = `[HistoryAdapter][${this.config.namespace}]`;

    if (level === "error") {
      console.error(`${prefix} ${message}`, data ?? "");
    } else {
      console.debug(`${prefix} ${message}`, data ?? "");
    }
  }
}

/**
 * Create a new History Adapter instance.
 *
 * Note: This is a synchronous factory. Call `attach(bus)` to initialize
 * IndexedDB and start the adapter.
 *
 * @param config - Adapter configuration
 * @returns HistoryAdapter instance
 *
 * @example
 * ```ts
 * const adapter = createHistoryAdapter({
 *   namespace: 'my-app',
 *   maxMessages: 500,
 *   ttlSeconds: 1800,
 * });
 *
 * await adapter.attach(bus);
 * ```
 */
export function createHistoryAdapter(config?: HistoryAdapterConfig): HistoryAdapter {
  return new HistoryAdapter(config);
}
