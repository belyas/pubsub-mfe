/**
 * Unique identifier for a browser tab/window.
 * Generated using crypto.randomUUID() or fallback.
 */
export type ClientId = string;

/**
 * Monotonic sequence number assigned by the broker (optional).
 * Used for ordered message replay and conflict resolution.
 */
export type SequenceNumber = number;

/**
 * Cross-tab message envelope.
 *
 * Wraps the original PubSub message with additional metadata for
 * cross-tab synchronization, deduplication, and routing.
 *
 * @template T - Payload type
 */
export interface CrossTabEnvelope<T = unknown> {
  /**
   * Original message ID from the publishing tab.
   * Used as primary deduplication key.
   */
  messageId: string;

  /**
   * Unique identifier of the tab that published this message.
   * Used for deduplication and filtering out echo messages.
   */
  clientId: ClientId;

  /**
   * Broker-assigned sequence number for this message.
   * Only present when SharedWorker broker is active.
   * Enables ordered replay and conflict resolution.
   */
  sequence?: SequenceNumber;

  /**
   * Pub/Sub topic for this message.
   */
  topic: string;

  /**
   * Message payload (application data).
   */
  payload: T;

  /**
   * Timestamp when message was published (milliseconds since epoch).
   */
  timestamp: number;

  /**
   * Optional source identifier (microfrontend name).
   */
  source?: string;

  /**
   * Optional schema version for payload validation.
   */
  schemaVersion?: string;

  /**
   * Additional metadata from the original message.
   */
  meta?: Record<string, unknown>;

  /**
   * Envelope format version.
   * Current version: 1
   */
  version: number;

  /**
   * Origin of the message (window.location.origin).
   * Used for security validation - only messages from same origin are accepted.
   */
  origin: string;
}

/**
 * Result of envelope validation.
 */
export interface EnvelopeValidationResult {
  /**
   * Whether the envelope is valid.
   */
  valid: boolean;

  /**
   * Validation error message (if invalid).
   */
  error?: string;

  /**
   * Specific validation error code.
   */
  code?: EnvelopeValidationErrorCode;
}

/**
 * Envelope validation error codes.
 */
export enum EnvelopeValidationErrorCode {
  MISSING_FIELD = "MISSING_FIELD",
  INVALID_VERSION = "INVALID_VERSION",
  INVALID_ORIGIN = "INVALID_ORIGIN",
  MESSAGE_TOO_LARGE = "MESSAGE_TOO_LARGE",
  INVALID_TYPE = "INVALID_TYPE",
}

/**
 * Configuration for the cross-tab adapter.
 */
export interface CrossTabAdapterConfig {
  /**
   * Name of the BroadcastChannel or SharedWorker.
   * Default: 'pubsub-mfe'
   */
  channelName?: string;

  /**
   * Transport instance to use for cross-tab communication.
   * Required.
   */
  transport: Transport;

  /**
   * Client ID for this tab.
   * If not provided, will be generated automatically.
   */
  clientId?: string;

  /**
   * Enable leadership detection.
   * Default: false
   */
  enableLeadership?: boolean;

  /**
   * Emit system events (tab initialized, leadership changed, etc.).
   * Default: true
   */
  emitSystemEvents?: boolean;

  /**
   * Maximum message size in bytes.
   * Messages exceeding this size are rejected.
   * Default: 262144 (256KB)
   */
  maxMessageSize?: number;

  /**
   * Rate limiting configuration for incoming messages.
   */
  rateLimit?: {
    /**
     * Maximum messages per second from other tabs.
     * Default: 100
     */
    maxPerSecond: number;

    /**
     * Maximum burst size (token bucket capacity).
     * Default: 200
     */
    maxBurst: number;
  };

  /**
   * Expected origin for messages.
   * If not provided, uses window.location.origin.
   * Messages from other origins are rejected.
   */
  expectedOrigin?: string;

  /**
   * Time window for deduplication in milliseconds.
   * Messages with the same messageId+clientId within this window are dropped.
   * Default: 60000 (60 seconds)
   */
  dedupeWindowMs?: number;

  /**
   * Maximum size of the deduplication cache (LRU).
   * Default: 1000
   */
  dedupeCacheSize?: number;

  /**
   * Batch outgoing messages for this duration (milliseconds).
   * Reduces overhead for high-frequency publishing.
   * Default: 10
   */
  batchIntervalMs?: number;

  /**
   * Maximum number of messages in a single batch.
   * When reached, the batch is flushed immediately.
   * Default: 50
   */
  maxBatchSize?: number;

  /**
   * Error handler for adapter errors.
   * Called when errors occur in transport or message processing.
   */
  onError?: (error: Error) => void;

  /**
   * Enable debug logging.
   * Default: false
   */
  debug?: boolean;
}

/**
 * Resolved configuration with all defaults applied.
 */
export interface ResolvedCrossTabConfig extends Required<CrossTabAdapterConfig> {
  rateLimit: {
    maxPerSecond: number;
    maxBurst: number;
  };
}

/**
 * Deduplication key format: messageId:clientId
 */
export type DedupeKey = string;

/**
 * Transport layer interface.
 * Abstracts the underlying communication mechanism (BroadcastChannel, StorageEvent, etc).
 */
export interface Transport {
  /**
   * Send an envelope to other tabs.
   */
  send(envelope: CrossTabEnvelope): void;

  /**
   * Register a handler for incoming envelopes.
   * Returns an unsubscribe function.
   */
  onMessage(handler: (envelope: CrossTabEnvelope) => void): () => void;

  /**
   * Close the transport and cleanup resources.
   */
  close(): void;

  /**
   * Check if the transport is available in the current environment.
   */
  isAvailable(): boolean;
}

/**
 * Statistics about adapter operation.
 */
export interface CrossTabStats {
  /**
   * Total messages sent to other tabs.
   */
  messagesSent: number;

  /**
   * Total messages received from other tabs.
   */
  messagesReceived: number;

  /**
   * Messages dropped due to deduplication.
   */
  messagesDeduplicated: number;

  /**
   * Messages rejected due to validation errors.
   */
  messagesRejected: number;

  /**
   * Messages dropped due to rate limiting.
   */
  messagesRateLimited: number;

  /**
   * Messages rejected because they exceeded the size limit.
   */
  messagesOversized: number;

  /**
   * Messages rejected due to origin not being in whitelist.
   */
  originBlocked: number;

  /**
   * Total number of batches sent.
   */
  batchesSent: number;

  /**
   * Average batch size (messages per batch).
   */
  averageBatchSize: number;

  /**
   * Maximum batch size seen.
   */
  maxBatchSizeSeen: number;

  /**
   * Current size of deduplication cache.
   */
  dedupeCacheSize: number;

  /**
   * Whether this tab is currently the leader.
   */
  isLeader: boolean;

  /**
   * Current client ID.
   */
  clientId: ClientId;
}
