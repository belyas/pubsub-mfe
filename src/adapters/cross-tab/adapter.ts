import type { PubSubBus, Message } from "../../types";
import type { Transport, CrossTabEnvelope, CrossTabAdapterConfig, CrossTabStats } from "./types";
import { getOrCreateClientId } from "./client-id";
import { DeduplicationCache } from "./deduplication";
import { LeadershipDetector } from "./leadership";
import { ENVELOPE_VERSION, validateAndSanitizeEnvelope } from "./envelope";
import { RateLimiter, OriginValidator, MessageSizeValidator } from "./security";
import { MessageBatcher } from "./batching";

const DEFAULT_MAX_MESSAGE_SIZE_BYTES = 256 * 1024;
const DEFAULT_DEDUPE_WINDOW_MS = 60000;

/**
 * Cross-tab adapter that integrates with PubSubBus via hooks.
 *
 * Sits alongside the bus (not inside it) and uses the hook system
 * to intercept published messages and inject received messages.
 *
 * @example
 * ```ts
 * const bus = new PubSubBus();
 *
 * const adapter = new CrossTabAdapter({
 *   channelName: 'my-app',
 *   transport: new BroadcastChannelTransport({ channelName: 'my-app' }),
 * });
 *
 * adapter.attach(bus);
 *
 * // Now messages are automatically synchronized across tabs
 * bus.publish({ topic: 'user.login', payload: { userId: 123 } });
 * ```
 */
export class CrossTabAdapter {
  private readonly transport: Transport;
  private readonly clientId: string;
  private readonly deduplicationCache: DeduplicationCache;
  private readonly leadership: LeadershipDetector | null;
  private readonly rateLimiter: RateLimiter | null;
  private readonly originValidator: OriginValidator;
  private readonly messageSizeValidator: MessageSizeValidator;
  private readonly batcher: MessageBatcher | null;
  private readonly config: Required<CrossTabAdapterConfig>;
  private bus: PubSubBus | null = null;
  private unsubscribeOnPublish?: () => void;
  private unsubscribeTransport?: () => void;
  private stats = {
    messagesSent: 0,
    messagesReceived: 0,
    messagesDeduplicated: 0,
    messagesRejected: 0,
    messagesRateLimited: 0,
    messagesOversized: 0,
    originBlocked: 0,
  };

  constructor(config: CrossTabAdapterConfig) {
    if (!config.transport) {
      throw new Error("transport is required in CrossTabAdapterConfig");
    }

    const channelName = config.channelName ?? "pubsub-mfe";
    const enableLeadership = config.enableLeadership ?? false;
    const emitSystemEvents = config.emitSystemEvents ?? true;
    const dedupeWindowMs = config.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
    const dedupeCacheSize = config.dedupeCacheSize ?? 1000;
    const maxMessageSize = config.maxMessageSize ?? DEFAULT_MAX_MESSAGE_SIZE_BYTES; // 256KB
    const expectedOrigin =
      config.expectedOrigin ??
      (typeof window !== "undefined" ? window.location.origin : "__INVALID_ORIGIN__");
    const debug = config.debug ?? false;

    this.config = {
      channelName,
      transport: config.transport,
      clientId: config.clientId,
      enableLeadership,
      emitSystemEvents,
      transportMode: config.transportMode,
      maxMessageSize,
      rateLimit: config.rateLimit,
      expectedOrigin,
      dedupeWindowMs,
      dedupeCacheSize,
      enableBroker: config.enableBroker,
      batchIntervalMs: config.batchIntervalMs,
      compressionThreshold: config.compressionThreshold,
      onError: config.onError,
      debug,
    } as Required<CrossTabAdapterConfig>;

    this.transport = config.transport;
    this.clientId = config.clientId ?? getOrCreateClientId();

    this.deduplicationCache = new DeduplicationCache({
      maxEntries: dedupeCacheSize,
      maxAgeMs: dedupeWindowMs,
      onDuplicate: (envelope) => {
        this.stats.messagesDeduplicated++;

        if (debug) {
          console.log("[CrossTabAdapter] Duplicate message filtered", {
            messageId: envelope.messageId,
            clientId: envelope.clientId,
          });
        }
      },
    });

    this.leadership = enableLeadership
      ? new LeadershipDetector({
          clientId: this.clientId,
          debug,
          onLeadershipChange: (isLeader) => {
            if (debug) {
              console.log("[CrossTabAdapter] Leadership changed", { isLeader });
            }

            if (this.bus && emitSystemEvents) {
              this.emitSystemEvent("system.tab.leadership-changed", { isLeader });
            }
          },
        })
      : null;

    this.rateLimiter = config.rateLimit
      ? new RateLimiter({
          maxPerSecond: config.rateLimit.maxPerSecond,
          maxBurst: config.rateLimit.maxBurst,
        })
      : null;

    this.originValidator = new OriginValidator({
      allowedOrigins: [expectedOrigin],
    });

    this.messageSizeValidator = new MessageSizeValidator({
      maxBytes: maxMessageSize,
    });

    const batchIntervalMs = config.batchIntervalMs ?? 0;
    const maxBatchSize = config.maxBatchSize ?? 50;

    this.batcher =
      batchIntervalMs > 0
        ? new MessageBatcher({
            intervalMs: config.batchIntervalMs ?? 10,
            maxBatchSize,
            onFlush: (envelopes) => {
              // Send the batch - wrap in try/catch to handle closed transport
              try {
                for (const envelope of envelopes) {
                  this.transport.send(envelope);
                }
                this.stats.messagesSent += envelopes.length;
              } catch (error) {
                if (debug) {
                  console.error("[CrossTabAdapter] Error sending batch", error);
                }
                if (this.config.onError) {
                  this.config.onError(error as Error);
                }
              }
            },
          })
        : null;

    if (debug) {
      console.log("[CrossTabAdapter] Initialized", {
        clientId: this.clientId,
        channelName,
        enableLeadership,
        emitSystemEvents,
        batching: this.batcher
          ? { intervalMs: config.batchIntervalMs ?? 0, maxBatchSize }
          : "disabled",
      });
    }
  }

  /**
   * Attach the adapter to a PubSubBus instance.
   *
   * Sets up hooks to intercept published messages and inject received messages.
   *
   * @param bus - The PubSubBus instance to attach to
   *
   * @throws Error if already attached to a bus
   *
   * @example
   * ```ts
   * const bus = new PubSubBus();
   * const adapter = new CrossTabAdapter({ channelName: 'my-app' });
   *
   * adapter.attach(bus);
   * ```
   */
  attach(bus: PubSubBus): void {
    if (this.bus) {
      throw new Error("CrossTabAdapter is already attached to a bus");
    }

    this.bus = bus;
    const hooks = bus.getHooks();

    // Hook 1: Intercept locally published messages
    this.unsubscribeOnPublish = hooks.onPublish((message: Message) => {
      this.handleLocalPublish(message);
    });

    // Hook 2: Listen for messages from other tabs
    this.unsubscribeTransport = this.transport.onMessage((envelope) => {
      this.handleRemoteMessage(envelope);
    });

    if (this.config.debug) {
      console.log("[CrossTabAdapter] Attached to bus", { clientId: this.clientId });
    }

    // Emit initialization event (after small delay to ensure transport is ready)
    if (this.config.emitSystemEvents) {
      setTimeout(() => this.notifyTabInitialized(), 100);
    }
  }

  /**
   * Detach the adapter from the bus.
   *
   * Cleans up all hooks, listeners, and resources.
   *
   * @example
   * ```ts
   * adapter.detach();
   * ```
   */
  detach(): void {
    if (!this.bus) {
      return;
    }

    if (this.unsubscribeOnPublish) {
      this.unsubscribeOnPublish();
      this.unsubscribeOnPublish = undefined;
    }

    if (this.unsubscribeTransport) {
      this.unsubscribeTransport();
      this.unsubscribeTransport = undefined;
    }

    if (this.leadership) {
      this.leadership.stop();
    }

    if (this.batcher) {
      this.batcher.dispose();
    }

    this.transport.close();

    this.bus = null;

    if (this.config.debug) {
      console.log("[CrossTabAdapter] Detached from bus");
    }
  }

  /**
   * Check if this tab is currently the leader.
   *
   * @returns true if leadership is enabled and this tab is the leader
   */
  isLeader(): boolean {
    return this.leadership?.isLeader() ?? false;
  }

  /**
   * Get current adapter statistics.
   *
   * @returns Statistics about adapter operation
   */
  getStats(): CrossTabStats {
    const batcherStats = this.batcher?.getStats();

    return {
      messagesSent: this.stats.messagesSent,
      messagesReceived: this.stats.messagesReceived,
      messagesDeduplicated: this.stats.messagesDeduplicated,
      messagesRejected: this.stats.messagesRejected,
      messagesRateLimited: this.stats.messagesRateLimited,
      messagesOversized: this.stats.messagesOversized,
      originBlocked: this.stats.originBlocked,
      batchesSent: batcherStats?.totalBatches ?? 0,
      averageBatchSize: batcherStats?.averageBatchSize ?? 0,
      maxBatchSizeSeen: batcherStats?.maxBatchSize ?? 0,
      dedupeCacheSize: this.deduplicationCache.getStats().size,
      isLeader: this.isLeader(),
      clientId: this.clientId,
    };
  }

  /**
   * Reconnect the adapter to the bus.
   *
   * Useful if the bus was temporarily unavailable.
   */
  reconnect() {
    if (this.bus && !this.unsubscribeOnPublish && !this.unsubscribeTransport) {
      this.attach(this.bus);
    }
  }

  /**
   * Handle a message published locally in this tab.
   *
   * Wraps it in a CrossTabEnvelope and broadcasts to other tabs.
   *
   * @private
   */
  private handleLocalPublish(message: Message): void {
    try {
      const envelope: CrossTabEnvelope = {
        messageId: message.id,
        clientId: this.clientId,
        topic: message.topic,
        payload: message.payload,
        timestamp: message.ts,
        version: 1,
        origin: typeof window !== "undefined" ? window.location.origin : "unknown",
      };

      if (!this.messageSizeValidator.isValid(envelope)) {
        this.stats.messagesOversized++;

        if (this.config.debug) {
          const size = this.messageSizeValidator.getSize(envelope);
          const maxSize = this.messageSizeValidator.getMaxSize();
          console.warn("[CrossTabAdapter] Message exceeds size limit", {
            messageId: envelope.messageId,
            size,
            maxSize,
          });
        }
        return;
      }

      // Use batcher if enabled, otherwise send directly
      if (this.batcher) {
        this.batcher.add(envelope);
      } else {
        this.transport.send(envelope);
        this.stats.messagesSent++;
      }

      if (this.config.debug) {
        console.log("[CrossTabAdapter] Broadcast message", {
          messageId: envelope.messageId,
          topic: envelope.topic,
          batched: !!this.batcher,
        });
      }
    } catch (error) {
      if (this.config.debug) {
        console.error("[CrossTabAdapter] Error broadcasting message", error);
      }
    }
  }

  /**
   * Handle a message received from another tab.
   *
   * Validates, deduplicates, and injects into local bus.
   *
   * @private
   */
  private handleRemoteMessage(envelope: CrossTabEnvelope): void {
    try {
      // First, validate envelope structure (before security checks)
      // This ensures envelope has required fields for security validation
      const sanitized = validateAndSanitizeEnvelope(envelope, this.config);

      if (!sanitized) {
        this.stats.messagesRejected++;

        if (this.config.debug) {
          console.warn("[CrossTabAdapter] Invalid envelope rejected", envelope);
        }
        return;
      }

      if (this.rateLimiter && !this.rateLimiter.allowMessage()) {
        this.stats.messagesRateLimited++;

        if (this.config.debug) {
          console.warn("[CrossTabAdapter] Message rate limited", {
            messageId: sanitized.messageId,
            limiterStats: this.rateLimiter.getStats(),
          });
        }
        return;
      }

      if (!this.originValidator.isAllowed(sanitized.origin)) {
        this.stats.originBlocked++;

        if (this.config.debug) {
          console.warn("[CrossTabAdapter] Message from blocked origin", {
            messageId: sanitized.messageId,
            origin: sanitized.origin,
          });
        }
        return;
      }

      if (!this.messageSizeValidator.isValid(sanitized)) {
        this.stats.messagesOversized++;

        if (this.config.debug) {
          const size = this.messageSizeValidator.getSize(sanitized);

          console.warn("[CrossTabAdapter] Received message exceeds size limit", {
            messageId: sanitized.messageId,
            size,
            maxSize: this.messageSizeValidator.getMaxSize(),
          });
        }
        return;
      }

      // Echo prevention: ignore messages from self
      if (sanitized.clientId === this.clientId) {
        return;
      }

      if (!this.deduplicationCache.checkAndMark(sanitized)) {
        // Duplicate detected and rejected (counted in onDuplicate callback)
        return;
      }

      const message: Message = {
        id: sanitized.messageId,
        topic: sanitized.topic,
        payload: sanitized.payload,
        ts: sanitized.timestamp,
        meta: {
          _crossTab: true,
          _sourceClientId: sanitized.clientId,
          _origin: sanitized.origin,
        },
      };

      if (this.bus) {
        const hooks = this.bus.getHooks();

        hooks.dispatchExternal(message);
        this.stats.messagesReceived++;

        if (this.config.debug) {
          console.log("[CrossTabAdapter] Received message", {
            messageId: message.id,
            topic: message.topic,
            fromClient: sanitized.clientId,
          });
        }
      }
    } catch (error) {
      this.stats.messagesRejected++;

      if (this.config.debug) {
        console.error("[CrossTabAdapter] Error handling remote message", error);
      }
    }
  }

  /**
   * Notify other tabs that this tab has initialized.
   *
   * Emits a system.tab.initialized event via the transport.
   *
   * @private
   */
  private notifyTabInitialized(): void {
    this.emitSystemEvent("system.tab.initialized", {
      clientId: this.clientId,
      timestamp: Date.now(),
      isLeader: this.isLeader(),
    });
  }

  /**
   * Emit a system event to other tabs.
   *
   * Helper method for emitting system.* messages.
   *
   * @private
   */
  private emitSystemEvent(topic: string, payload: unknown): void {
    try {
      const envelope: CrossTabEnvelope = {
        messageId: `system-${this.clientId}-${Date.now()}`,
        clientId: this.clientId,
        topic,
        payload,
        timestamp: Date.now(),
        version: ENVELOPE_VERSION,
        origin: typeof window !== "undefined" ? window.location.origin : "unknown",
      };

      this.transport.send(envelope);
    } catch (error) {
      if (this.config.debug) {
        console.error("[CrossTabAdapter] Error emitting system event", topic, error);
      }
    }
  }
}

/**
 * Create a cross-tab adapter with the given configuration.
 *
 * Convenience factory function.
 *
 * @param config - Adapter configuration
 *
 * @returns A new CrossTabAdapter instance
 *
 * @example
 * ```ts
 * const adapter = createCrossTabAdapter({
 *   channelName: 'my-app',
 *   transport: new BroadcastChannelTransport({ channelName: 'my-app' }),
 *   enableLeadership: true,
 * });
 * ```
 */
export function createCrossTabAdapter(config: CrossTabAdapterConfig): CrossTabAdapter {
  return new CrossTabAdapter(config);
}
