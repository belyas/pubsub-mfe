import type {
  IframeClientConfig,
  IframeEnvelope,
  IframeClientStats,
  DisconnectReason,
  IframeAckEnvelope,
  IframeMessageEnvelope,
  IframeDisconnectEnvelope,
} from "./types";
import { generateClientId } from "../cross-tab/client-id";
import { compileMatcher, matchTopic } from "../../topic-matcher";
import type { CompiledMatcher } from "../../types";

export const PROTOCOL_VERSION = 1;
const DEFAULT_HANDSHAKE_TIMEOUT = 5000;

/**
 * Resolved configuration with defaults applied.
 */
interface ResolvedIframeClientConfig extends Required<IframeClientConfig> {
  onConnected: (hostClientId: string) => void;
  onDisconnected: (reason: DisconnectReason) => void;
}

/**
 * Message received from host bus.
 */
interface ReceivedMessage {
  messageId: string;
  topic: string;
  payload: unknown;
  timestamp: number;
  schemaVersion?: string;
  source?: string;
}

/**
 * Iframe-side adapter providing PubSub-like API for sandboxed microfrontends.
 *
 * Features:
 * - Responds to host handshake (SYN → ACK)
 * - Receives MessagePort for secure communication
 * - Publish/subscribe API with wildcard support
 * - Auto-reconnect on disconnect
 * - Explicit disconnect support for application-initiated cleanup
 *
 * Note: Does not hook page lifecycle events (pagehide, beforeunload) because:
 * - Host detects iframe disconnect passively when port.postMessage() fails
 * - Page unload events are unreliable and may not deliver messages anyway
 * - Keeps client simple and relies on host's robust detection mechanisms
 *
 * Usage:
 * ```ts
 * const client = new IframeClient({
 *   expectedHostOrigin: "https://host.example.com"
 * });
 *
 * await client.connect();
 *
 * client.subscribe("cart.#", (message) => {
 *   console.log("Cart event:", message);
 * });
 *
 * client.publish("cart.add", { itemId: 123 });
 *
 * // Explicit disconnect when needed (e.g. user closes widget)
 * client.disconnect();
 * ```
 */
export class IframeClient {
  private readonly config: ResolvedIframeClientConfig;
  private readonly clientId: string;
  private readonly subscriptions = new Map<string, Set<(message: ReceivedMessage) => void>>();
  private readonly matchers = new Map<string, CompiledMatcher>();
  private readonly windowMessageListener: (event: MessageEvent) => void;
  private readonly portMessageListener: (event: MessageEvent) => void;
  private port: MessagePort | null = null;
  private connected = false;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private connectResolver: ((value: void) => void) | null = null;
  private connectRejecter: ((error: Error) => void) | null = null;
  private messagesPublished = 0;
  private messagesReceived = 0;
  private connectionAttempts = 0;
  private disconnections = 0;

  constructor(config: IframeClientConfig) {
    this.config = this.resolveConfig(config);
    this.clientId = generateClientId();

    this.windowMessageListener = this.handleWindowMessage.bind(this);
    this.portMessageListener = this.handlePortMessage.bind(this);
  }

  /**
   * Resolve configuration with defaults.
   */
  private resolveConfig(config: IframeClientConfig): ResolvedIframeClientConfig {
    return {
      expectedHostOrigin: config.expectedHostOrigin,
      handshakeTimeout: config.handshakeTimeout ?? DEFAULT_HANDSHAKE_TIMEOUT,
      autoReconnect: config.autoReconnect ?? true,
      debug: config.debug ?? false,
      onConnected: config.onConnected ?? (() => {}),
      onDisconnected: config.onDisconnected ?? (() => {}),
    };
  }

  /**
   * Wait for connection to be established.
   * Returns promise that resolves when handshake completes.
   */
  async connect(): Promise<void> {
    if (this.connected) {
      this.log("warn", "Already connected");
      return;
    }

    if (typeof window === "undefined") {
      throw new Error("IframeClient can only be used in browser environment");
    }

    this.connectionAttempts++;
    this.log("info", `Connecting (attempt ${this.connectionAttempts})`);

    // Setup window message listener for handshake
    window.addEventListener("message", this.windowMessageListener);

    return new Promise<void>((resolve, reject) => {
      this.connectResolver = resolve;
      this.connectRejecter = reject;

      this.handshakeTimer = setTimeout(() => {
        this.handleHandshakeTimeout();
      }, this.config.handshakeTimeout);
    });
  }

  /**
   * Publish message to host.
   */
  publish(topic: string, payload: unknown, options?: { schemaVersion?: string }): void {
    if (!this.connected || !this.port) {
      this.log("warn", `Cannot publish: not connected (topic: ${topic})`);
      return;
    }

    const envelope: IframeMessageEnvelope = {
      type: "pubsub:MESSAGE",
      version: PROTOCOL_VERSION,
      payload: {
        messageId: generateClientId(),
        topic,
        payload,
        timestamp: Date.now(),
        schemaVersion: options?.schemaVersion,
        source: this.clientId,
      },
    };

    try {
      this.port.postMessage(envelope);
      this.messagesPublished++;
      this.log("debug", `Published: ${topic}`, envelope);
    } catch (error) {
      this.log(
        "error",
        `Failed to publish: ${error instanceof Error ? error.message : String(error)}`
      );
      this.handleDisconnect("send_failed");
    }
  }

  /**
   * Subscribe to messages from host.
   * Returns unsubscribe function.
   */
  subscribe(topic: string, handler: (message: ReceivedMessage) => void): () => void {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
      this.matchers.set(topic, compileMatcher(topic));
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.subscriptions.get(topic)!.add(handler);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.log("debug", `Subscribed: ${topic} (${this.subscriptions.get(topic)!.size} handlers)`);

    return () => {
      const handlers = this.subscriptions.get(topic);

      if (handlers) {
        handlers.delete(handler);

        if (handlers.size === 0) {
          this.subscriptions.delete(topic);
          this.matchers.delete(topic);
        }

        this.log("debug", `Unsubscribed: ${topic} (${handlers.size} handlers remaining)`);
      }
    };
  }

  /**
   * Disconnect from host and cleanup.
   */
  disconnect(): void {
    if (!this.connected) {
      this.log("warn", "Already disconnected");
      return;
    }

    this.log("info", "Disconnecting");

    if (this.port) {
      try {
        const envelope: IframeDisconnectEnvelope = {
          type: "pubsub:DISCONNECT",
          version: PROTOCOL_VERSION,
        };
        this.port.postMessage(envelope);
      } catch (error) {
        this.log(
          "debug",
          `Failed to send disconnect: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    this.handleDisconnect("explicit_disconnect");
  }

  /**
   * Alias for disconnect.
   */
  detach(): void {
    this.disconnect();
  }

  /**
   * Get current stats.
   */
  getStats(): IframeClientStats {
    return {
      connected: this.connected,
      messagesPublished: this.messagesPublished,
      messagesReceived: this.messagesReceived,
      connectionAttempts: this.connectionAttempts,
      disconnections: this.disconnections,
    };
  }

  /**
   * Handle window message events (handshake).
   */
  private handleWindowMessage(event: MessageEvent): void {
    if (event.origin !== this.config.expectedHostOrigin) {
      this.log("warn", `Message from unexpected origin: ${event.origin}`);
      return;
    }

    const envelope = event.data as IframeEnvelope;

    if (!envelope?.type || envelope.version !== PROTOCOL_VERSION) {
      this.log("warn", "Invalid envelope", envelope);
      return;
    }

    if (envelope.type === "pubsub:SYN") {
      this.handleSynMessage(event);
    } else if (envelope.type === "pubsub:ACK_CONFIRM") {
      this.handleAckConfirmMessage(event);
    }
  }

  /**
   * Handle SYN message from host.
   */
  private handleSynMessage(event: MessageEvent): void {
    this.log("info", "Received SYN from host");

    const ackEnvelope: IframeAckEnvelope = {
      type: "pubsub:ACK",
      version: PROTOCOL_VERSION,
      clientId: this.clientId,
      capabilities: ["publish", "subscribe", "wildcards"],
    };

    if (event.source && typeof (event.source as Window).postMessage === "function") {
      (event.source as Window).postMessage(ackEnvelope, {
        targetOrigin: this.config.expectedHostOrigin,
      });
      this.log("info", "Sent ACK to host", ackEnvelope);
    } else {
      this.log("error", "Cannot send ACK: invalid event.source");
    }
  }

  /**
   * Handle ACK_CONFIRM message with MessagePort.
   */
  private handleAckConfirmMessage(event: MessageEvent): void {
    if (!event.ports || event.ports.length === 0) {
      this.log("error", "ACK_CONFIRM missing MessagePort");
      return;
    }

    this.log("info", "Received ACK_CONFIRM with MessagePort");

    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }

    this.port = event.ports[0];
    this.port.addEventListener("message", this.portMessageListener);
    this.port.start();

    this.connected = true;
    this.log("info", "Connection established");

    this.config.onConnected(this.clientId);

    if (this.connectResolver) {
      this.connectResolver();
      this.connectResolver = null;
      this.connectRejecter = null;
    }
  }

  /**
   * Handle messages from host via MessagePort.
   */
  private handlePortMessage(event: MessageEvent): void {
    const envelope = event.data as IframeEnvelope;

    if (!envelope?.type || envelope.version !== PROTOCOL_VERSION) {
      this.log("warn", "Invalid envelope on port", envelope);
      return;
    }

    if (envelope.type === "pubsub:MESSAGE") {
      this.handleMessageEnvelope(envelope as IframeMessageEnvelope);
    } else if (envelope.type === "pubsub:DISCONNECT") {
      this.log("info", "Host requested disconnect");
      this.handleDisconnect("explicit_disconnect");
    }
  }

  /**
   * Handle MESSAGE envelope from host.
   * Filters out echo messages (messages sent by this client).
   */
  private handleMessageEnvelope(envelope: IframeMessageEnvelope): void {
    const { topic, payload, messageId, timestamp, schemaVersion, source } = envelope.payload;

    if (source === this.clientId) {
      this.log("debug", `Ignoring echo message: ${topic}`);
      return;
    }

    this.messagesReceived++;
    this.log("debug", `Received: ${topic}`, envelope.payload);

    const message: ReceivedMessage = {
      messageId,
      topic,
      payload,
      timestamp,
      schemaVersion,
      source,
    };

    this.matchAndDispatch(topic, message);
  }

  /**
   * Match topic and dispatch to matching subscribers.
   */
  private matchAndDispatch(topic: string, message: ReceivedMessage): void {
    for (const [pattern, handlers] of this.subscriptions.entries()) {
      const matcher = this.matchers.get(pattern);

      if (matcher && matchTopic(topic, matcher)) {
        for (const handler of handlers) {
          try {
            handler(message);
          } catch (error) {
            this.log(
              "error",
              `Subscriber error: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }
    }
  }

  /**
   * Handle handshake timeout.
   */
  private handleHandshakeTimeout(): void {
    this.log("error", "Handshake timeout");

    if (this.connectRejecter) {
      this.connectRejecter(new Error("Handshake timeout"));
      this.connectResolver = null;
      this.connectRejecter = null;
    }

    if (this.config.autoReconnect) {
      this.attemptReconnect();
    }
  }

  /**
   * Handle disconnect.
   */
  private handleDisconnect(reason: DisconnectReason): void {
    if (!this.connected) {
      return;
    }

    this.log("info", `Disconnecting (${reason})`);

    this.connected = false;
    this.disconnections++;

    if (this.port) {
      this.port.close();
      this.port = null;
    }

    this.config.onDisconnected(reason);

    if (this.config.autoReconnect && reason !== "explicit_disconnect") {
      this.attemptReconnect();
    }
  }

  /**
   * Attempt to reconnect.
   */
  private attemptReconnect(): void {
    this.log("info", "Attempting to reconnect...");

    // Wait a bit before reconnecting
    setTimeout(() => {
      this.connect().catch((error) => {
        this.log(
          "error",
          `Reconnect failed: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    }, 1000);
  }

  /**
   * Debug logging helper.
   */
  private log(
    level: "info" | "warn" | "error" | "debug",
    message: string,
    ...args: unknown[]
  ): void {
    if (!this.config.debug && level === "debug") {
      return;
    }

    const prefix = "[IframeClient]";

    (console as Console)[level]?.(prefix, message, ...args);
  }
}

/**
 * Factory function to create and connect an IframeClient adapter.
 *
 * @param config - Configuration for the IframeClient
 *
 * @returns Promise that resolves to connected IframeClient instance
 *
 * @example
 * ```typescript
 * const client = await createIframeClient({
 *   expectedHostOrigin: 'https://host.example.com'
 * });
 *
 * client.subscribe('cart.#', (msg) => {
 *   console.log('Cart event:', msg);
 * });
 *
 * client.publish('cart.add', { item: 'widget', qty: 1 });
 * ```
 */
export async function createIframeClient(config: IframeClientConfig): Promise<IframeClient> {
  const client = new IframeClient(config);

  await client.connect();
  return client;
}
