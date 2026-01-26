import type { CrossTabEnvelope } from "../types";
import { serializeEnvelope, deserializeEnvelope } from "../envelope";
import { BaseTransport, TransportConfig, TransportError, TransportErrorCode } from "./base";
import { generateClientId } from "../client-id";

/**
 * Storage transport configuration.
 */
export interface StorageTransportConfig extends TransportConfig {
  channelName: string;
  clientId?: string;
  storage?: Storage;
  ttlMs?: number;
  cleanupIntervalMs?: number;
  maxMessages?: number;
  keyPrefix?: string;
}

const DEFAULT_TTL_MS = 30000; // 30 seconds
const DEFAULT_CLEANUP_INTERVAL_MS = 10000; // 10 seconds
const DEFAULT_MAX_MESSAGES = 100;
const DEFAULT_KEY_PREFIX = "pubsub-mfe";

/**
 * StorageTransport uses localStorage and the StorageEvent API
 * for cross-tab communication. Each message is stored with a unique
 * timestamp-prefixed key and cleaned up based on TTL.
 */
export class StorageTransport extends BaseTransport {
  readonly name = "Storage";
  private readonly config: Required<
    Omit<StorageTransportConfig, "onError" | "debug" | "storage">
  > & {
    storage: Storage;
  };
  private readonly storageListener: (event: StorageEvent) => void;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly processedMessageIds = new Set<string>();
  private readonly maxProcessedIds = 1000;

  constructor(config: StorageTransportConfig) {
    super({ onError: config.onError, debug: config.debug ?? false });

    this.config = {
      channelName: config.channelName,
      clientId: config.clientId ?? generateClientId(),
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      storage: config.storage ?? (typeof localStorage !== "undefined" ? localStorage : null!),
      ttlMs: config.ttlMs ?? DEFAULT_TTL_MS,
      cleanupIntervalMs: config.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS,
      maxMessages: config.maxMessages ?? DEFAULT_MAX_MESSAGES,
      keyPrefix: config.keyPrefix ?? DEFAULT_KEY_PREFIX,
    };

    this.storageListener = this.handleStorageEvent.bind(this);

    if (this.isAvailable()) {
      this.initialize();
    } else {
      const reason = "localStorage is not available in this environment";
      this.errorHandler(new TransportError(TransportErrorCode.NOT_AVAILABLE, reason));
    }
  }

  isAvailable(): boolean {
    if (typeof window === "undefined" || !this.config.storage) {
      return false;
    }

    try {
      const testKey = `${this.config.keyPrefix}-test-${Date.now()}`;

      this.config.storage.setItem(testKey, "test");
      this.config.storage.removeItem(testKey);

      return true;
    } catch {
      return false;
    }
  }

  getClientId(): string {
    return this.config.clientId;
  }

  private initialize(): void {
    window.addEventListener("storage", this.storageListener);
    // Cleanup expired messages on init
    this.cleanupExpiredMessages();
    // Start periodic cleanup
    this.cleanupTimer = setInterval(
      () => this.cleanupExpiredMessages(),
      this.config.cleanupIntervalMs
    );
    this.debug("Initialized", {
      channelName: this.config.channelName,
      clientId: this.config.clientId,
      ttlMs: this.config.ttlMs,
    });
  }

  private getKeyPattern(): string {
    return `${this.config.keyPrefix}:${this.config.channelName}:`;
  }

  private createMessageKey(): string {
    // Timestamp-prefixed key for ordering and cleanup
    const timestamp = Date.now().toString(36).padStart(9, "0");
    const random = Math.random().toString(36).slice(2, 8);

    return `${this.getKeyPattern()}${timestamp}-${random}`;
  }

  private isOurKey(key: string | null): boolean {
    if (!key) {
      return false;
    }

    return key.startsWith(this.getKeyPattern());
  }

  send(envelope: CrossTabEnvelope): void {
    if (!this.assertNotClosed("send")) {
      return;
    }
    if (!this.isAvailable()) {
      this.errorHandler(
        new TransportError(TransportErrorCode.NOT_AVAILABLE, "Storage is not available")
      );
      return;
    }

    try {
      const key = this.createMessageKey();
      const serialized = serializeEnvelope(envelope);
      const wrapper = JSON.stringify({
        payload: serialized,
        timestamp: Date.now(),
        senderId: this.config.clientId,
      });

      this.config.storage.setItem(key, wrapper);
      this.debug("Sent message", {
        topic: envelope.topic,
        messageId: envelope.messageId,
        key,
        size: wrapper.length,
      });
      // Cleanup after write to prevent unbounded growth
      this.enforceMaxMessages();
    } catch (error) {
      if (this.isQuotaError(error)) {
        this.debug("Storage quota exceeded, attempting cleanup");
        this.cleanupExpiredMessages();

        try {
          const key = this.createMessageKey();
          const serialized = serializeEnvelope(envelope);
          const wrapper = JSON.stringify({
            payload: serialized,
            timestamp: Date.now(),
            senderId: this.config.clientId,
          });

          this.config.storage.setItem(key, wrapper);
          this.debug("Retry successful after cleanup");
          return;
        } catch (retryError) {
          this.errorHandler(
            new TransportError(
              TransportErrorCode.SEND_FAILED,
              "Storage quota exceeded even after cleanup",
              retryError instanceof Error ? retryError : undefined
            )
          );
          return;
        }
      }

      this.errorHandler(
        new TransportError(
          TransportErrorCode.SEND_FAILED,
          `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  private isQuotaError(error: unknown): boolean {
    if (error instanceof DOMException) {
      return error.name === "QuotaExceededError" || error.code === 22;
    }

    return false;
  }

  private handleStorageEvent(event: StorageEvent): void {
    if (this.closed || !this.isOurKey(event.key) || event.newValue === null) {
      return;
    }

    try {
      const wrapper = JSON.parse(event.newValue) as {
        payload: string;
        timestamp: number;
        senderId: string;
      };
      // Ignore messages from ourselves
      if (wrapper.senderId === this.config.clientId) {
        return;
      }

      const envelope = deserializeEnvelope(wrapper.payload);
      // Deduplication check
      if (this.processedMessageIds.has(envelope.messageId)) {
        this.debug("Duplicate message ignored", { messageId: envelope.messageId });
        return;
      }

      this.trackProcessedMessage(envelope.messageId);
      this.debug("Received message", {
        topic: envelope.topic,
        messageId: envelope.messageId,
        clientId: envelope.clientId,
        key: event.key,
      });
      this.dispatch(envelope);
    } catch (error) {
      this.errorHandler(
        new TransportError(
          TransportErrorCode.DESERIALIZATION_FAILED,
          `Failed to deserialize message: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  private trackProcessedMessage(messageId: string): void {
    this.processedMessageIds.add(messageId);

    // Prevent unbounded growth of processedMessageIds
    if (this.processedMessageIds.size > this.maxProcessedIds) {
      const iterator = this.processedMessageIds.values();

      for (let i = 0; i < this.maxProcessedIds / 2; i++) {
        const next = iterator.next();

        if (next.done) break;
        this.processedMessageIds.delete(next.value);
      }
    }
  }

  private cleanupExpiredMessages(): void {
    if (this.closed || !this.config.storage) {
      return;
    }

    const now = Date.now();
    const keysToRemove: string[] = [];
    const keyPattern = this.getKeyPattern();

    try {
      for (let i = 0; i < this.config.storage.length; i++) {
        const key = this.config.storage.key(i);

        if (!key || !key.startsWith(keyPattern)) {
          continue;
        }

        try {
          const value = this.config.storage.getItem(key);
          if (!value) {
            keysToRemove.push(key);
            continue;
          }

          const wrapper = JSON.parse(value) as { timestamp: number };
          if (now - wrapper.timestamp > this.config.ttlMs) {
            keysToRemove.push(key);
          }
        } catch {
          // Malformed entry, remove it
          keysToRemove.push(key);
        }
      }

      for (const key of keysToRemove) {
        this.config.storage.removeItem(key);
      }

      if (keysToRemove.length > 0) {
        this.debug("Cleaned up expired messages", { count: keysToRemove.length });
      }
    } catch (error) {
      this.debug("Cleanup error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private enforceMaxMessages(): void {
    if (!this.config.storage) {
      return;
    }

    const keyPattern = this.getKeyPattern();
    const messages: Array<{ key: string; timestamp: number }> = [];

    try {
      for (let i = 0; i < this.config.storage.length; i++) {
        const key = this.config.storage.key(i);
        if (!key || !key.startsWith(keyPattern)) {
          continue;
        }

        try {
          const value = this.config.storage.getItem(key);
          if (value) {
            const wrapper = JSON.parse(value) as { timestamp: number };
            messages.push({ key, timestamp: wrapper.timestamp });
          }
        } catch {
          // Skip malformed entries
        }
      }

      if (messages.length > this.config.maxMessages) {
        // Sort by timestamp (oldest first)
        messages.sort((a, b) => a.timestamp - b.timestamp);

        const excess = messages.length - this.config.maxMessages;
        for (let i = 0; i < excess; i++) {
          this.config.storage.removeItem(messages[i].key);
        }
        this.debug("Enforced max messages limit", {
          removed: excess,
          remaining: this.config.maxMessages,
        });
      }
    } catch (error) {
      this.debug("Max messages enforcement error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Clear all messages for this channel from storage.
   */
  clearChannel(): void {
    if (!this.config.storage) {
      return;
    }

    const keyPattern = this.getKeyPattern();
    const keysToRemove: string[] = [];

    for (let i = 0; i < this.config.storage.length; i++) {
      const key = this.config.storage.key(i);
      if (key && key.startsWith(keyPattern)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      this.config.storage.removeItem(key);
    }

    this.debug("Cleared channel", { removed: keysToRemove.length });
  }

  protected cleanup(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", this.storageListener);
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.processedMessageIds.clear();
    this.debug("Closed Storage transport");
  }
}

export function createStorageTransport(config: StorageTransportConfig): StorageTransport {
  return new StorageTransport(config);
}
