/** Unique message identifier (UUID v4 format) */
export type MessageId = string;

/** Unix timestamp in milliseconds */
export type Timestamp = number;

/** Topic string using dot notation (e.g., "cart.item.add") */
export type Topic = string;

/** Schema version tag (e.g., "cart.item.add@1") */
export type SchemaVersion = string;

/**
 * Message envelope — the atomic unit of communication.
 *
 * - `id`: Enables deduplication, tracing, and idempotent processing
 * - `topic`: Hierarchical dot notation for routing
 * - `ts`: Ordering and TTL calculations
 * - `schemaVersion`: Optional typed payload contracts
 * - `payload`: The actual data (T)
 * - `meta`: Extensible metadata for observability/routing
 */
export interface Message<T = unknown> {
  readonly id: MessageId;
  readonly topic: Topic;
  readonly ts: Timestamp;
  readonly schemaVersion?: SchemaVersion;
  readonly payload: T;
  readonly meta?: MessageMeta;
}

/** Optional message metadata for observability and routing */
export interface MessageMeta {
  /** Source identifier (e.g. component ID, microfrontend name) */
  readonly source?: string;
  /** Correlation ID for request-response patterns */
  readonly correlationId?: string;
  /** Custom properties */
  readonly [key: string]: unknown;
}

/**
 * Message handler — receives validated messages.
 *
 * IMPORTANT: Handlers should be lightweight and non-blocking.
 * Heavy work should be deferred via queueMicrotask or requestIdleCallback.
 */
export type MessageHandler<T = unknown> = (message: Message<T>) => void | Promise<void> | unknown;

/**
 * Subscription options for fine-grained control.
 */
export interface SubscribeOptions {
  /**
   * AbortSignal for subscription lifecycle management.
   * When aborted, the handler is automatically unsubscribed.
   *
   * @example
   * const controller = new AbortController();
   * bus.subscribe('cart.#', handler, { signal: controller.signal });
   * // Later: controller.abort(); // Auto-unsubscribes
   */
  signal?: AbortSignal;

  /**
   * Replay last N messages on subscribe from in-memory retention buffer.
   * Messages are delivered synchronously before live delivery begins.
   *
   * Requires `retention.maxMessages` > 0 in bus config.
   * Only replays messages matching the subscription pattern.
   *
   * @default 0 (no replay)
   *
   * @example
   * // Get last 5 cart events on subscribe
   * bus.subscribe('cart.#', handler, { replay: 5 });
   */
  replay?: number;

  /**
   * Source filter — only receive messages from specific sources.
   * Useful for ignoring own messages in bidirectional scenarios.
   */
  sourceFilter?: {
    include?: string[];
    exclude?: string[];
  };
}

/**
 * Publish options for message customization.
 */
export interface PublishOptions {
  /**
   * Source identifier for the publisher.
   * Used for source filtering and diagnostics.
   */
  source?: string;

  /**
   * Schema version to validate against.
   * If provided, payload is validated before dispatch.
   */
  schemaVersion?: SchemaVersion;

  /**
   * Correlation ID for request-response tracing.
   */
  correlationId?: string;

  /**
   * Additional metadata to attach.
   */
  meta?: Omit<MessageMeta, "source" | "correlationId">;
}

/**
 * Unsubscribe function returned by subscribe().
 * Calling it removes the handler from the topic.
 */
export type Unsubscribe = () => void;

/**
 * JSON Schema subset for payload validation.
 * Intentionally minimal — no external dependencies.
 */
export interface JsonSchema {
  type?: "object" | "array" | "string" | "number" | "boolean" | "null";
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

/**
 * Schema validation mode.
 * - strict: Reject invalid payloads (publish throws)
 * - warn: Log validation errors but still dispatch
 * - off: Skip validation entirely
 */
export type ValidationMode = "strict" | "warn" | "off";

/**
 * Validation result from schema check.
 */
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors?: readonly ValidationError[];
}

export interface ValidationError {
  readonly path: string;
  readonly message: string;
  readonly expected?: string;
  readonly actual?: unknown;
}

/**
 * PubSub bus configuration options.
 */
export interface PubSubConfig {
  /**
   * Application identifier for namespacing.
   * Used in cross-tab scenarios to isolate applications.
   */
  app?: string;

  /**
   * Default validation mode for all schemas.
   *
   * @default 'off'
   */
  validationMode?: ValidationMode;

  /**
   * Diagnostics hook for observability.
   * Receives internal events: errors, validation failures, metrics.
   */
  onDiagnostic?: DiagnosticHandler;

  /**
   * Maximum handlers per topic (prevents memory leaks).
   *
   * @default 50
   */
  maxHandlersPerTopic?: number;

  /**
   * Behavior when max handlers limit is exceeded.
   * - 'throw': Throw an error (default)
   * - 'warn': Emit diagnostic warning and reject subscription silently
   *
   * @default 'throw'
   */
  onMaxHandlersExceeded?: "throw" | "warn";

  /**
   * Enable debug logging to console.
   *
   * @default false
   */
  debug?: boolean;

  /**
   * Enable DevTools integration.
   *
   * Recommended for development only.
   * Consider: enableDevTools: process.env.NODE_ENV !== 'production'
   *
   * @default false
   */
  enableDevTools?: boolean;

  /**
   * In-memory message retention for replay support.
   *
   * When configured, the bus retains recent messages in a circular buffer
   * allowing new subscribers to replay past messages without an external
   * history adapter.
   */
  retention?: RetentionConfig;

  /**
   * Rate limiting configuration to prevent DoS from rogue microfrontends.
   * Uses a sliding window algorithm.
   */
  rateLimit?: RateLimitConfig;
}

/**
 * Configuration for in-memory message retention.
 */
export interface RetentionConfig {
  /**
   * Maximum number of messages to retain globally.
   * Uses a circular buffer — oldest messages are evicted when full.
   *
   * @default 0 (no retention)
   *
   * @example
   * // Retain last 100 messages across all topics
   * retention: { maxMessages: 100 }
   */
  maxMessages: number;

  /**
   * Optional per-topic retention limits.
   * Keys are exact topics or patterns (e.g., "cart.#").
   *
   * @example
   * // Different limits per topic
   * retention: {
   *   maxMessages: 100,
   *   perTopic: {
   *     'cart.#': 20,      // Keep last 20 cart events
   *     'metrics.#': 50,    // Keep last 50 metrics
   *   }
   * }
   */
  perTopic?: Record<string, number>;

  /**
   * Time-to-live in milliseconds.
   * Messages older than TTL are not included in replay.
   *
   * @default undefined (no TTL)
   *
   * @example
   * // Only replay messages from last 5 minutes
   * retention: { maxMessages: 100, ttlMs: 5 * 60 * 1000 }
   */
  ttlMs?: number;
}

/**
 * Configuration for rate limiting publish operations.
 * Uses a sliding window algorithm to prevent DoS.
 */
export interface RateLimitConfig {
  /**
   * Maximum messages allowed per second.
   * @default undefined
   */
  maxPerSecond: number;

  /**
   * Maximum burst size (messages allowed in quick succession).
   * @default undefined
   */
  maxBurst?: number;

  /**
   * Action when rate limit is exceeded.
   * - 'drop': Silently drop the message
   * - 'throw': Throw an error
   *
   * @default 'drop'
   */
  onExceeded?: "drop" | "throw";
}

export type DiagnosticEvent =
  | DiagnosticPublish
  | DiagnosticSubscribe
  | DiagnosticUnsubscribe
  | DiagnosticHandlerError
  | DiagnosticValidationError
  | DiagnosticWarning
  | DiagnosticLimitExceeded
  | DiagnosticRateLimited;

export interface DiagnosticPublish {
  readonly type: "publish";
  readonly topic: Topic;
  readonly messageId: MessageId;
  readonly handlerCount: number;
  readonly durationMs: number;
  readonly message?: string;
}

export interface DiagnosticSubscribe {
  readonly type: "subscribe";
  readonly pattern: string;
  readonly handlerCount: number;
  readonly message?: string;
}

export interface DiagnosticUnsubscribe {
  readonly type: "unsubscribe";
  readonly pattern: string;
  readonly handlerCount: number;
}

export interface DiagnosticHandlerError {
  readonly type: "handler-error";
  readonly topic: Topic;
  readonly messageId: MessageId;
  readonly error: Error;
  readonly handlerIndex: number;
}

export interface DiagnosticValidationError {
  readonly type: "validation-error";
  readonly topic: Topic;
  readonly schemaVersion: SchemaVersion;
  readonly errors: readonly ValidationError[];
  readonly mode: ValidationMode;
}

export interface DiagnosticWarning {
  readonly type: "warning";
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface DiagnosticLimitExceeded {
  readonly type: "limit-exceeded";
  readonly limitType: "max-handlers" | "max-retained" | "max-topics";
  readonly topic?: Topic;
  readonly currentCount: number;
  readonly maxAllowed: number;
  readonly message: string;
}

export interface DiagnosticRateLimited {
  readonly type: "rate-limited";
  readonly topic: Topic;
  readonly currentRate: number;
  readonly maxRate: number;
  readonly action: "drop" | "throw";
  readonly message: string;
}

export type DiagnosticHandler = (event: DiagnosticEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// Topic Pattern Types (MQTT-style wildcards)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Topic pattern for subscriptions.
 * Supports MQTT-style wildcards:
 * - `+` matches exactly one level (e.g., `cart.+.update` matches `cart.item.update`)
 * - `#` matches zero or more levels (e.g., `cart.#` matches `cart`, `cart.item`, `cart.item.add`)
 *
 * Examples:
 * - `cart.item.add` — exact match
 * - `cart.+.update` — single-level wildcard
 * - `cart.#` — multi-level wildcard
 */
export type TopicPattern = string;

/**
 * Compiled topic matcher for efficient repeated matching.
 * Uses segment-by-segment comparison (Trie-like algorithm).
 */
export interface CompiledMatcher {
  readonly pattern: TopicPattern;
  readonly hasWildcards: boolean;
  readonly segments: MatcherSegment[];
}

export type MatcherSegment =
  | { readonly type: "literal"; readonly value: string }
  | { readonly type: "single" } // +
  | { readonly type: "multi" }; // #

/**
 * Pub/Sub bus interface.
 *
 * This is the core API surface for microfrontend communication
 * within a single document/page context.
 */
export interface PubSubBus {
  /**
   * Subscribe to a topic pattern.
   *
   * @param pattern - Topic pattern (exact or with wildcards)
   * @param handler - Message handler function
   * @param options - Subscription options
   * @returns Unsubscribe function
   *
   * @example
   * // Exact topic
   * bus.subscribe('cart.item.add', (msg) => console.log(msg.payload));
   *
   * // Single-level wildcard
   * bus.subscribe('cart.+.update', (msg) => console.log(msg.topic));
   *
   * // Multi-level wildcard with AbortSignal
   * const controller = new AbortController();
   * bus.subscribe('cart.#', handler, { signal: controller.signal });
   */
  subscribe<T = unknown>(
    pattern: TopicPattern,
    handler: MessageHandler<T>,
    options?: SubscribeOptions
  ): Unsubscribe;

  /**
   * Publish a message to a topic.
   *
   * @param topic - Exact topic (no wildcards)
   * @param payload - Message payload
   * @param options - Publish options
   * @returns The published message envelope
   * @throws If validation fails in strict mode
   *
   * @example
   * bus.publish('cart.item.add', { sku: 'ABC123', qty: 1 });
   */
  publish<T = unknown>(topic: Topic, payload: T, options?: PublishOptions): Message<T>;

  /**
   * Register a JSON schema for payload validation.
   *
   * @param schemaVersion - Schema identifier with version (e.g., "cart.item.add@1")
   * @param schema - JSON Schema definition
   *
   * @example
   * bus.registerSchema('cart.item.add@1', {
   *   type: 'object',
   *   properties: { sku: { type: 'string' }, qty: { type: 'number' } },
   *   required: ['sku', 'qty'],
   * });
   */
  registerSchema(schemaVersion: SchemaVersion, schema: JsonSchema): void;

  /**
   * Get message history for a topic pattern.
   * Returns messages from the in-memory retention buffer.
   *
   * Requires `retention.maxMessages` > 0 in bus config.
   *
   * @param topic - Topic pattern to filter (supports wildcards)
   * @param options - History query options
   *
   * @returns Promise resolving to array of matching messages
   *
   * @example
   * // Get last 10 cart events from the last 5 minutes
   * const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
   * const history = await bus.getHistory('cart.#', {
   *   fromTime: fiveMinutesAgo,
   *   limit: 10
   * });
   */
  getHistory<T = unknown>(
    topic: Topic,
    options?: { fromTime?: number; limit?: number }
  ): Promise<Message<T>[]>;

  /**
   * Get current handler count for a pattern.
   * Useful for debugging and diagnostics.
   */
  handlerCount(pattern?: TopicPattern): number;

  /**
   * Get bus statistics and metadata.
   * Useful for observability and DevTools integrations.
   */
  getStats(): BusStats;

  /**
   * Get active subscription details.
   * Includes topic patterns and handler counts.
   */
  getSubscriptions(): SubscriptionInfo[];

  /**
   * Clear all subscriptions.
   * Use with caution — typically for testing or cleanup.
   */
  clear(): void;

  /**
   * Dispose the bus and all subscriptions.
   * After disposal, the bus should not be used.
   */
  dispose(): void;

  /**
   * Get hooks for adapter integration.
   * Used by cross-tab, iframe, and other adapters to bridge messages.
   */
  getHooks(): BusHooks;
}

/**
 * Hook interface for adapter integration.
 * Adapters use this to listen for local publishes and inject external messages.
 */
export interface BusHooks {
  onPublish(listener: (message: Message) => void): Unsubscribe;
  dispatchExternal(message: Message): void;
}

/**
 * Runtime statistics for a bus instance.
 */
export interface BusStats {
  instanceId: string;
  app: string;
  handlerCount: number;
  subscriptionPatterns: string[];
  retentionBufferSize: number;
  retentionBufferCapacity: number;
  messageCount: {
    published: number;
    dispatched: number;
  };
  disposed: boolean;
}

/**
 * Metadata exposed for DevTools discovery.
 */
export interface BusMetadata {
  instanceId: string;
  app: string;
  createdAt: number;
  config: {
    app: string;
    validationMode?: string;
    debug?: boolean;
    enableDevTools?: boolean;
  };
}

/**
 * Serializable error shape for postMessage/JSON transfer.
 */
export interface SerializableError {
  name: string;
  message: string;
  stack?: string;
}

/**
 * Subscription metadata for diagnostics and DevTools views.
 */
export interface SubscriptionInfo {
  pattern: string;
  handlerCount: number;
  createdAt: number;
}

/**
 * Result of checking a regex pattern for ReDoS vulnerabilities.
 */
export interface RegexSafetyCheck {
  /** Whether the pattern is potentially unsafe */
  unsafe: boolean;
  /** Human-readable reason if unsafe */
  reason?: string;
}
