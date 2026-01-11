import { RetentionRingBuffer } from "./retention-buffer";
import {
  clearSchemas,
  hasSchema,
  registerSchema,
  validateAgainstVersion,
} from "./schema-validator";
import {
  clearMatcherCache,
  compileMatcher,
  matchTopic,
  validatePublishTopic,
} from "./topic-matcher";
import type {
  BusHooks,
  CompiledMatcher,
  DiagnosticEvent,
  DiagnosticHandler,
  JsonSchema,
  Message,
  MessageHandler,
  PublishOptions,
  PubSubBus,
  PubSubConfig,
  RateLimitConfig,
  RetentionConfig,
  SchemaVersion,
  SubscribeOptions,
  Topic,
  TopicPattern,
  Unsubscribe,
  ValidationMode,
} from "./types";
import { generateMessageId, getTimestamp, safePick } from "./utils";

interface Subscription {
  handler: MessageHandler;
  matcher: CompiledMatcher;
  options: SubscribeOptions;
  abortListener?: () => void;
}

interface ResolvedConfig {
  app: string;
  validationMode: ValidationMode;
  onDiagnostic: DiagnosticHandler;
  maxHandlersPerTopic: number;
  onMaxHandlersExceeded: "throw" | "warn";
  debug: boolean;
  retention?: RetentionConfig;
  rateLimit?: RateLimitConfig;
  clonePayloads: boolean;
}

const DEFAULT_CONFIG: ResolvedConfig = {
  app: "default",
  validationMode: "off",
  onDiagnostic: () => {},
  maxHandlersPerTopic: 50,
  onMaxHandlersExceeded: "throw",
  debug: false,
  retention: undefined,
  rateLimit: undefined,
  clonePayloads: true,
};

/**
 * Allowed configuration keys.
 * Only these properties will be extracted from untrusted config objects.
 * This prevents prototype pollution and arbitrary property injection.
 */
const ALLOWED_CONFIG_KEYS = Object.keys(DEFAULT_CONFIG);

export class PubSubBusImpl implements PubSubBus {
  private readonly config: ResolvedConfig;
  private readonly subscriptions = new Map<TopicPattern, Set<Subscription>>();
  private retentionBuffer: RetentionRingBuffer | null = null;
  private readonly publishListeners = new Set<(message: Message) => void>();
  private disposed = false;
  private rateLimitTokens: number = 0;
  private rateLimitLastRefill: number = 0;

  constructor(config: PubSubConfig = {}) {
    const sanitizedConfig = safePick(config, ALLOWED_CONFIG_KEYS) as Partial<PubSubConfig>;

    this.config = { ...DEFAULT_CONFIG, ...sanitizedConfig };

    if (this.config.retention && this.config.retention.maxMessages > 0) {
      this.retentionBuffer = new RetentionRingBuffer(
        this.config.retention.maxMessages,
        this.config.retention.ttlMs
      );
    }

    if (this.config.rateLimit) {
      const burst = this.config.rateLimit.maxBurst ?? this.config.rateLimit.maxPerSecond;
      this.rateLimitTokens = burst;
      this.rateLimitLastRefill = globalThis.performance.now();
    }

    this.debug("PubSubBus initialized", { app: this.config.app });
  }

  subscribe<T = unknown>(
    pattern: TopicPattern,
    handler: MessageHandler<T>,
    options: SubscribeOptions = {}
  ): Unsubscribe {
    this.assertNotDisposed("subscribe");

    if (options.signal?.aborted) {
      this.debug("Subscription skipped — signal already aborted", { pattern });

      return () => {};
    }

    const matcher = compileMatcher(pattern);
    const subscription: Subscription = {
      handler: handler as MessageHandler,
      matcher,
      options,
    };
    let patternSubscriptions = this.subscriptions.get(pattern);

    if (!patternSubscriptions) {
      patternSubscriptions = new Set();
      this.subscriptions.set(pattern, patternSubscriptions);
    }

    if (patternSubscriptions.size > this.config.maxHandlersPerTopic) {
      const error = new Error(
        `Maximum handlers (${this.config.maxHandlersPerTopic}) reached for pattern "${pattern}".`
      );
      this.emitDiagnostic({
        type: "limit-exceeded",
        limitType: "max-handlers",
        topic: pattern,
        currentCount: patternSubscriptions.size,
        maxAllowed: this.config.maxHandlersPerTopic,
        message: error.message,
      });

      if (this.config.onMaxHandlersExceeded === "throw") {
        throw error;
      }

      return () => {};
    }

    patternSubscriptions.add(subscription);

    const unsubscribe = () => {
      this.removeSubscription(pattern, subscription);
    };

    if (options.signal) {
      const abortListener = () => {
        this.debug("Subscription aborted via signal", { pattern });
        unsubscribe();
      };
      subscription.abortListener = abortListener;
      options.signal.addEventListener("abort", abortListener, { once: true });
    }

    this.emitDiagnostic({
      type: "subscribe",
      pattern,
      handlerCount: patternSubscriptions.size,
    });

    this.debug("Subscribed", { pattern, handlerCount: patternSubscriptions.size });

    if (options.replay && options.replay > 0) {
      this.replayMessages(handler as MessageHandler, matcher, options.replay);
    }

    return unsubscribe;
  }

  publish<T = unknown>(topic: Topic, payload: T, options: PublishOptions = {}): Message<T> {
    this.assertNotDisposed("publish");

    const startTime = globalThis.performance.now();

    if (this.config.rateLimit && !this.tryConsumeRateLimitToken(topic)) {
      const action = this.config.rateLimit.onExceeded ?? "drop";
      const message = `Rate limit exceeded for topic "${topic}". Max ${this.config.rateLimit.maxPerSecond}/sec.`;

      this.emitDiagnostic({
        type: "rate-limited",
        topic,
        currentRate: this.config.rateLimit.maxPerSecond,
        maxRate: this.config.rateLimit.maxPerSecond,
        action,
        message,
      });

      if (action === "throw") {
        throw new Error(message);
      }

      // return a dummy message for "drop" mode
      return {
        id: generateMessageId(),
        topic,
        ts: getTimestamp(),
        payload,
        schemaVersion: options.schemaVersion,
        meta: {
          source: options.source,
          correlationId: options.correlationId,
          _rateLimited: true,
          ...options.meta,
        },
      } as Message<T>;
    }

    try {
      validatePublishTopic(topic);
    } catch (error) {
      this.emitDiagnostic({
        type: "warning",
        code: "INVALID_TOPIC",
        message: error instanceof Error ? error.message : String(error),
        details: { topic },
      });
      throw error;
    }

    if (options.schemaVersion) {
      this.validatePayload(payload, options.schemaVersion, topic);
    }

    const message: Message<T> = {
      id: generateMessageId(),
      topic,
      ts: getTimestamp(),
      payload,
      schemaVersion: options.schemaVersion,
      meta: {
        source: options.source,
        correlationId: options.correlationId,
        ...options.meta,
      },
    };
    const matchedHandlers = this.findMatchingHandlers(topic, options.source);

    this.retainMessage(message);

    // Dispatch asynchronously via queueMicrotask for consistent timing
    // This ensures handlers don't block the publisher synchronously
    this.dispatchToHandlers(message, matchedHandlers);

    // Notify publish listeners (for adapters)
    this.notifyPublishListeners(message);

    const durationMs = globalThis.performance.now() - startTime;

    this.emitDiagnostic({
      type: "publish",
      topic,
      messageId: message.id,
      handlerCount: matchedHandlers.length,
      durationMs,
    });

    this.debug("Published", { topic, messageId: message.id, handlerCount: matchedHandlers.length });

    return message;
  }

  registerSchema(schemaVersion: SchemaVersion, schema: JsonSchema) {
    this.assertNotDisposed("registerSchema");
    registerSchema(schemaVersion, schema);
    this.debug("Schema registered", { schemaVersion });
  }

  handlerCount(pattern?: TopicPattern) {
    if (pattern) {
      return this.subscriptions.get(pattern)?.size ?? 0;
    }

    let total = 0;

    for (const subs of this.subscriptions.values()) {
      total += subs.size;
    }

    return total;
  }

  clear() {
    this.assertNotDisposed("clear");

    for (const subs of this.subscriptions.values()) {
      for (const sub of subs) {
        if (sub.options.signal && sub.abortListener) {
          sub.options.signal.removeEventListener("abort", sub.abortListener);
        }
      }
    }

    this.subscriptions.clear();
    this.retentionBuffer?.clear();

    this.debug("All subscriptions and retention buffer cleared");
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.clear();
    this.publishListeners.clear();
    this.disposed = true;
    this.debug("Bus disposed");
  }

  getHooks(): BusHooks {
    this.assertNotDisposed("getHooks");
    return {
      onPublish(_listener: (message: Message) => void): Unsubscribe {
        return () => {};
      },
      dispatchExternal(_message: Message) {},
    };
  }

  private validatePayload<T>(payload: T, schemaVersion: SchemaVersion, topic: Topic): void {
    const mode = this.config.validationMode;

    if (mode === "off") {
      return;
    }

    if (!hasSchema(schemaVersion)) {
      const message = `Schema "${schemaVersion}" is not registered.`;
      if (mode === "strict") {
        throw new Error(message);
      }

      this.emitDiagnostic({
        type: "warning",
        code: "SCHEMA_NOT_FOUND",
        message,
        details: { schemaVersion, topic },
      });
      return;
    }

    const result = validateAgainstVersion(payload, schemaVersion);

    if (!result.valid && result.errors) {
      this.emitDiagnostic({
        type: "validation-error",
        topic,
        schemaVersion,
        errors: result.errors,
        mode,
      });

      if (mode === "strict") {
        const errorMessages = result.errors.map((e) => `${e.path}: ${e.message}`).join("; ");

        throw new Error(`Validation failed for schema "${schemaVersion}": ${errorMessages}`);
      }

      if (this.config.debug) {
        console.warn(`[PubSub] Validation warning on topic "${topic}"`, {
          schemaVersion,
          errors: result.errors,
        });
      }
    }
  }

  private removeSubscription(pattern: TopicPattern, subscription: Subscription): void {
    const patternSubscriptions = this.subscriptions.get(pattern);

    if (!patternSubscriptions) {
      return;
    }

    if (subscription.options.signal && subscription.abortListener) {
      subscription.options.signal.removeEventListener("abort", subscription.abortListener);
    }

    patternSubscriptions.delete(subscription);

    if (patternSubscriptions.size === 0) {
      this.subscriptions.delete(pattern);
    }

    this.emitDiagnostic({
      type: "unsubscribe",
      pattern,
      handlerCount: patternSubscriptions.size,
    });

    this.debug("Unsubscribed", { pattern, remaining: patternSubscriptions.size });
  }

  private replayMessages(handler: MessageHandler, matcher: CompiledMatcher, count: number): void {
    if (!this.retentionBuffer) {
      this.debug("Replay skipped — no retention configured");
      return;
    }

    const now = getTimestamp();
    const messages = this.retentionBuffer.getMessages(now);
    const matching = messages.filter((msg) => matchTopic(msg.topic, matcher));
    const toReplay = matching.slice(-count);

    if (toReplay.length === 0) {
      this.debug("Replay: no matching messages", { pattern: matcher.pattern, count });
      return;
    }

    this.debug("Replaying messages", {
      pattern: matcher.pattern,
      requested: count,
      replaying: toReplay.length,
    });

    for (const message of toReplay) {
      this.safeInvokeHandler(handler, message, -1); // -1 indicates replay
    }
  }

  private retainMessage(message: Message): void {
    if (!this.retentionBuffer) return;

    const now = getTimestamp();
    const evicted = this.retentionBuffer.evictExpired(now);

    if (evicted > 0) {
      this.debug("TTL eviction", { evicted });
    }

    this.retentionBuffer.push(message);

    this.debug("Message retained", {
      topic: message.topic,
      bufferSize: this.retentionBuffer.size,
      maxMessages: this.config.retention?.maxMessages,
    });
  }

  private findMatchingHandlers(
    topic: Topic,
    source?: string
  ): Array<{ handler: MessageHandler; index: number }> {
    const handlers: Array<{ handler: MessageHandler; index: number }> = [];
    let index = 0;

    for (const [, subs] of this.subscriptions) {
      for (const sub of subs) {
        if (!matchTopic(topic, sub.matcher)) {
          continue;
        }

        if (!this.passesSourceFilter(source, sub.options.sourceFilter)) {
          continue;
        }

        handlers.push({ handler: sub.handler, index: index++ });
      }
    }

    return handlers;
  }

  private notifyPublishListeners(message: Message): void {
    for (const listener of this.publishListeners) {
      try {
        listener(message);
      } catch (e) {
        // Swallow listener errors to prevent cascading failures
        this.debug("Publish listener error", { error: e });
      }
    }
  }

  private passesSourceFilter(
    source: string | undefined,
    filter: SubscribeOptions["sourceFilter"]
  ): boolean {
    if (!filter) {
      return true;
    }

    // Exclude filter takes precedence
    if (filter.exclude && source && filter.exclude.includes(source)) {
      return false;
    }

    if (filter.include) {
      return source !== undefined && filter.include.includes(source);
    }

    return true;
  }

  private dispatchToHandlers<T>(
    message: Message<T>,
    handlers: Array<{ handler: MessageHandler<T>; index: number }>
  ): void {
    globalThis.queueMicrotask(() => {
      for (const { handler, index } of handlers) {
        this.safeInvokeHandler(handler, message, index);
      }
    });
  }

  /**
   * Invoke a handler with error isolation (Bulkhead pattern).
   *
   * If a handler throws, the error is caught, logged to diagnostics,
   * and does not propagate to other handlers or the publisher.
   */
  private safeInvokeHandler<T>(
    handler: MessageHandler<T>,
    message: Message<T>,
    handlerIndex: number
  ): void {
    try {
      const result = handler(message);

      if (result instanceof Promise) {
        result.catch((error: Error) => {
          this.handleHandlerError(error, message, handlerIndex);
        });
      }
    } catch (error) {
      this.handleHandlerError(error as Error, message, handlerIndex);
    }
  }

  private handleHandlerError<T>(error: Error, message: Message<T>, handlerIndex: number): void {
    this.emitDiagnostic({
      type: "handler-error",
      topic: message.topic,
      messageId: message.id,
      error,
      handlerIndex,
    });

    if (this.config.debug) {
      console.error(`[PubSub] Handler error on topic "${message.topic}"`, {
        messageId: message.id,
        handlerIndex,
        error,
      });
    }
  }

  private emitDiagnostic(event: DiagnosticEvent): void {
    try {
      this.config.onDiagnostic(event);
    } catch (e) {
      // Swallow diagnostic handler errors to prevent cascading failures
      this.debug((e as Error)?.message, { error: e });
    }
  }

  /**
   * Token bucket rate limiter.
   * Refills tokens based on elapsed time and checks if a token can be consumed.
   */
  private tryConsumeRateLimitToken(_topic: Topic): boolean {
    if (!this.config.rateLimit) {
      return true;
    }

    const now = globalThis.performance.now();
    const elapsedMs = now - this.rateLimitLastRefill;
    const { maxPerSecond, maxBurst } = this.config.rateLimit;

    // Refill tokens based on elapsed time
    const tokensToAdd = (elapsedMs / 1000) * maxPerSecond;
    this.rateLimitTokens = Math.min(maxBurst || maxPerSecond, this.rateLimitTokens + tokensToAdd);
    this.rateLimitLastRefill = now;

    // Try to consume a token
    if (this.rateLimitTokens >= 1) {
      this.rateLimitTokens -= 1;
      return true;
    }

    return false;
  }

  private debug(message: string, data?: Record<string, unknown>) {
    if (this.config.debug) {
      console.debug(`[PubSubBus][${this.config.app}] ${message}.`, data ?? "");
    }
  }

  private assertNotDisposed(operation: string): void {
    if (this.disposed) {
      throw new Error(`Cannot ${operation}: bus has been disposed.`);
    }
  }
}

/**
 * Create a new Pub/Sub bus instance.
 *
 * @param config - Optional configuration
 *
 * @returns PubSubBus instance
 *
 * @example
 * const bus = createPubSub({ app: 'my-app', debug: true });
 *
 * bus.subscribe('cart.item.add', (msg) => {
 *   console.log('Item added:', msg.payload);
 * });
 *
 * bus.publish('cart.item.add', { sku: 'ABC123', qty: 1 });
 */
export function createPubSub(config?: PubSubConfig): PubSubBus {
  return new PubSubBusImpl(config);
}

/**
 * Reset all internal state — schemas and matcher cache.
 * Use only in tests!
 */
export function __resetForTesting(): void {
  clearSchemas();
  clearMatcherCache();
}
