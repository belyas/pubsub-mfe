import type { Message, Topic } from "../../types";

/**
 * Configuration for the History Adapter.
 */
export interface HistoryAdapterConfig {
  /**
   * IndexedDB database name.
   * @default 'pubsub-history'
   */
  dbName?: string;

  /**
   * Namespace prefix for storage isolation.
   * If not provided, auto-derived from bus app config on attach.
   * @default 'default'
   */
  namespace?: string;

  /**
   * Maximum number of messages to persist globally.
   * Oldest messages are evicted when this limit is reached.
   * @default 1000
   */
  maxMessages?: number;

  /**
   * Time-to-live in seconds.
   * Messages older than TTL are candidates for garbage collection.
   * @default 3600 (1 hour)
   */
  ttlSeconds?: number;

  /**
   * Garbage collection interval in milliseconds.
   * Periodic full GC runs at this interval.
   * @default 60000 (1 minute)
   */
  gcIntervalMs?: number;

  /**
   * Enable debug logging.
   * @default false
   */
  debug?: boolean;

  /**
   * Error callback for storage and GC errors.
   */
  onError?: (error: Error) => void;
}

/**
 * Resolved configuration with defaults applied.
 */
export interface ResolvedHistoryConfig {
  dbName: string;
  namespace: string;
  maxMessages: number;
  ttlSeconds: number;
  gcIntervalMs: number;
  debug: boolean;
  onError?: (error: Error) => void;
}

/**
 * Statistics about the history adapter's operation.
 */
export interface HistoryAdapterStats {
  /** Total messages persisted since adapter creation */
  messagesPersisted: number;

  /** Total messages retrieved via getHistory */
  messagesRetrieved: number;

  /** Messages removed by garbage collection */
  messagesGarbageCollected: number;

  /** Number of duplicate messages skipped (already in storage) */
  duplicatesSkipped: number;

  /** Number of GC cycles completed */
  gcCyclesCompleted: number;

  /** Current estimated message count in storage */
  estimatedStorageCount: number;

  /** Last GC timestamp (ms since epoch) */
  lastGcTimestamp: number | null;

  /** Whether the adapter is currently attached to a bus */
  attached: boolean;

  /** Current namespace */
  namespace: string;
}

/**
 * Options for getHistory query.
 */
export interface HistoryQueryOptions {
  /**
   * Return messages with timestamp >= fromTime.
   * Milliseconds since epoch.
   */
  fromTime?: number;

  /**
   * Maximum number of messages to return.
   * Returns the most recent N messages matching the query.
   */
  limit?: number;
}

/**
 * Internal storage record for persisted messages.
 * Stored in IndexedDB with additional metadata.
 */
export interface StoredMessage<T = unknown> {
  /** Message ID (primary key) */
  id: string;

  /** Original topic */
  topic: Topic;

  /** Timestamp in milliseconds (for indexing and TTL) */
  timestamp: number;

  /** Namespace for multi-app isolation */
  namespace: string;

  /** The full message envelope */
  message: Message<T>;

  /** When this record was created (for GC ordering) */
  createdAt: number;
}

/**
 * Result of a garbage collection run.
 */
export interface GarbageCollectionResult {
  /** Number of messages removed due to TTL expiration */
  expiredRemoved: number;

  /** Number of messages removed due to max count overflow */
  overflowRemoved: number;

  /** Total messages removed */
  totalRemoved: number;

  /** Duration of GC in milliseconds */
  durationMs: number;
}

/**
 * Internal interface for the storage layer.
 */
export interface HistoryStorage {
  /**
   * Initialize the storage (open IndexedDB).
   */
  open(): Promise<void>;

  /**
   * Close the storage connection.
   */
  close(): void;

  /**
   * Check if storage is currently open.
   */
  isOpen(): boolean;

  /**
   * Store a message (deduplicated by ID).
   * @returns true if stored, false if duplicate
   */
  put(record: StoredMessage): Promise<boolean>;

  /**
   * Get a message by ID.
   */
  get(id: string): Promise<StoredMessage | undefined>;

  /**
   * Query messages by namespace and optional topic pattern.
   *
   * @param namespace - Namespace to filter by
   * @param topic - Topic pattern (supports wildcards)
   * @param options - Query options (fromTime, limit)
   */
  query(namespace: string, topic: Topic, options?: HistoryQueryOptions): Promise<StoredMessage[]>;

  /**
   * Delete a message by ID.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete multiple messages by IDs.
   */
  deleteMany(ids: string[]): Promise<void>;

  /**
   * Get all messages older than timestamp in namespace.
   * Used by garbage collector.
   */
  getExpired(namespace: string, beforeTimestamp: number): Promise<StoredMessage[]>;

  /**
   * Get count of messages in namespace.
   */
  count(namespace: string): Promise<number>;

  /**
   * Get oldest messages in namespace (for overflow GC).
   *
   * @param namespace - Namespace to query
   * @param count - Number of oldest messages to return
   */
  getOldest(namespace: string, count: number): Promise<StoredMessage[]>;

  /**
   * Clear all messages in a namespace.
   */
  clearNamespace(namespace: string): Promise<void>;
}
