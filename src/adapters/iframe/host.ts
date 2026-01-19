import type { PubSubBus, Message } from "../../types";
import type {
  IframeHostConfig,
  IframeRegistration,
  IframeEnvelope,
  IframeHostStats,
  DisconnectReason,
  IframeSynEnvelope,
  IframeAckEnvelope,
  IframeAckConfirmEnvelope,
  IframeMessageEnvelope,
  IframeDisconnectEnvelope,
} from "./types";

export const PROTOCOL_VERSION = 1;
const DEFAULT_HANDSHAKE_TIMEOUT = 5000;
const DEFAULT_MAX_RETRIES = 2;

/**
 * Resolved configuration with defaults applied.
 */
interface ResolvedIframeHostConfig extends Required<IframeHostConfig> {
  onHandshakeComplete: (iframe: HTMLIFrameElement, clientId: string) => void;
  onHandshakeFailed: (iframe: HTMLIFrameElement, origin: string, error: Error) => void;
  onIframeDisconnected: (iframe: HTMLIFrameElement, reason: DisconnectReason) => void;
  onValidationError: (iframe: HTMLIFrameElement, topic: string, error: Error) => void;
}

/**
 * Host-side iframe adapter using MessageChannel for secure communication.
 *
 * Features:
 * - Trusted Handshake protocol (SYN → ACK → ACK_CONFIRM)
 * - Dedicated MessageChannel per iframe
 * - Origin validation on every message
 * - Auto-reconnect on iframe reload
 * - Passive/active/explicit disconnect detection
 *
 * Usage:
 * ```ts
 * const host = new IframeHost(bus, {
 *   trustedOrigins: ["https://child.example.com"]
 * });
 *
 * const iframe = document.querySelector("iframe");
 * await host.registerIframe(iframe, "https://child.example.com");
 * ```
 */
export class IframeHost {
  private readonly bus: PubSubBus;
  private readonly config: ResolvedIframeHostConfig;
  private readonly registrations = new Map<HTMLIFrameElement, IframeRegistration>();
  private readonly observer: MutationObserver | null;
  private readonly windowMessageListener: (event: MessageEvent) => void;
  private unsubscribe: (() => void) | null = null;
  private attached = false;
  private totalIframes = 0;
  private messagesSent = 0;
  private messagesReceived = 0;
  private handshakesFailed = 0;
  private messagesDropped = 0;
  private validationErrors = 0;

  constructor(bus: PubSubBus, config: IframeHostConfig) {
    this.bus = bus;
    this.config = this.resolveConfig(config);

    // Setup MutationObserver for passive disconnect detection
    if (typeof MutationObserver !== "undefined") {
      this.observer = new MutationObserver((mutations) => {
        this.handleDomMutations(mutations);
      });
    } else {
      this.observer = null;
    }

    this.windowMessageListener = this.handleWindowMessage.bind(this);
  }

  /**
   * Attach to bus and start monitoring for removed iframes.
   */
  attach(): void {
    if (this.attached) {
      this.log("warn", "Already attached");
      return;
    }

    this.unsubscribe = this.bus.subscribe("#", (message) => {
      this.handleBusMessage(message);
    });

    if (this.observer && typeof document !== "undefined") {
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    if (typeof window !== "undefined") {
      window.addEventListener("message", this.windowMessageListener);
    }

    this.attached = true;
    this.log("info", "Attached to bus");
  }

  /**
   * Detach from bus and cleanup all iframes.
   */
  detach(): void {
    if (!this.attached) {
      return;
    }

    for (const registration of this.registrations.values()) {
      this.disconnectIframe(registration, "explicit_disconnect", false);
    }

    this.registrations.clear();
    this.observer?.disconnect();

    if (typeof window !== "undefined") {
      window.removeEventListener("message", this.windowMessageListener);
    }

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.attached = false;
    this.log("info", "Detached from bus");
  }

  /**
   * Register an iframe for pub/sub communication.
   *
   * @param iframe - The iframe element to register
   * @param origin - Expected origin of the iframe
   *
   * @returns Promise that resolves when handshake completes
   */
  async registerIframe(iframe: HTMLIFrameElement, origin: string): Promise<void> {
    if (!this.attached) {
      throw new Error("IframeHost must be attached before registering iframes");
    }

    if (!this.isOriginTrusted(origin)) {
      const error = new Error(`Untrusted origin: ${origin}`);

      this.log("error", `Registration failed: ${error.message}`);
      throw error;
    }

    if (this.registrations.has(iframe)) {
      this.log("warn", `Iframe already registered for origin: ${origin}`);
      return;
    }

    const registration: IframeRegistration = {
      iframe,
      origin,
      port: null,
      clientId: null,
      state: "pending",
      retryCount: 0,
      handshakeTimer: null,
      loadListener: null,
    };

    this.registrations.set(iframe, registration);
    this.totalIframes++;

    // Setup load event listener for auto-reconnect
    if (this.config.autoReconnect) {
      const loadListener = () => {
        this.log("info", `Iframe reloaded: ${origin}`);
        this.reconnectIframe(registration);
      };

      iframe.addEventListener("load", loadListener);
      registration.loadListener = loadListener;
    }

    this.log("info", `Registering iframe: ${origin}`);
    await this.initiateHandshake(registration);
  }

  /**
   * Unregister an iframe and disconnect communication.
   *
   * @param iframe - The iframe to unregister
   */
  unregisterIframe(iframe: HTMLIFrameElement): void {
    const registration = this.registrations.get(iframe);

    if (!registration) {
      this.log("warn", "Iframe not registered");
      return;
    }

    this.log("info", `Unregistering iframe: ${registration.origin}`);
    this.disconnectIframe(registration, "explicit_disconnect", true);
    this.registrations.delete(iframe);
  }

  /**
   * Get current statistics.
   */
  getStats(): IframeHostStats {
    const connectedIframes = Array.from(this.registrations.values()).filter(
      (r) => r.state === "connected"
    ).length;

    return {
      totalIframes: this.totalIframes,
      connectedIframes,
      messagesSent: this.messagesSent,
      messagesReceived: this.messagesReceived,
      handshakesFailed: this.handshakesFailed,
      messagesDropped: this.messagesDropped,
      validationErrors: this.validationErrors,
    };
  }

  private resolveConfig(config: IframeHostConfig): ResolvedIframeHostConfig {
    return {
      trustedOrigins: config.trustedOrigins,
      handshakeTimeout: config.handshakeTimeout ?? DEFAULT_HANDSHAKE_TIMEOUT,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      autoReconnect: config.autoReconnect ?? true,
      enforceSchemaValidation: config.enforceSchemaValidation ?? false,
      debug: config.debug ?? false,
      onHandshakeComplete: config.onHandshakeComplete ?? (() => {}),
      onHandshakeFailed: config.onHandshakeFailed ?? (() => {}),
      onIframeDisconnected: config.onIframeDisconnected ?? (() => {}),
      onValidationError: config.onValidationError ?? (() => {}),
    };
  }

  private isOriginTrusted(origin: string): boolean {
    return this.config.trustedOrigins.includes(origin);
  }

  private async initiateHandshake(registration: IframeRegistration): Promise<void> {
    registration.state = "handshaking";

    if (registration.handshakeTimer) {
      clearTimeout(registration.handshakeTimer);
    }

    const timeoutPromise = new Promise<void>((_, reject) => {
      registration.handshakeTimer = setTimeout(() => {
        reject(new Error("Handshake timeout"));
      }, this.config.handshakeTimeout);
    });

    const synMessage: IframeSynEnvelope = {
      type: "pubsub:SYN",
      version: PROTOCOL_VERSION,
    };

    try {
      const contentWindow = registration.iframe.contentWindow;

      if (!contentWindow) {
        throw new Error("Iframe contentWindow is null");
      }

      this.log("debug", `Sending SYN to ${registration.origin}`);
      contentWindow.postMessage(synMessage, registration.origin);

      // Wait for ACK (handled in handleWindowMessage)
      await Promise.race([timeoutPromise, this.waitForHandshakeComplete(registration)]);

      if (registration.handshakeTimer) {
        clearTimeout(registration.handshakeTimer);
        registration.handshakeTimer = null;
      }

      this.log("info", `Handshake complete: ${registration.origin}`);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.config.onHandshakeComplete(registration.iframe, registration.clientId!);
    } catch (error) {
      this.log("error", `Handshake failed: ${(error as Error).message}`);

      if (registration.retryCount < this.config.maxRetries) {
        registration.retryCount++;
        this.log(
          "info",
          `Retrying handshake (${registration.retryCount}/${this.config.maxRetries})`
        );
        await this.initiateHandshake(registration);
      } else {
        this.handshakesFailed++;
        registration.state = "disconnected";
        this.config.onHandshakeFailed(registration.iframe, registration.origin, error as Error);
        throw error;
      }
    }
  }

  private waitForHandshakeComplete(registration: IframeRegistration): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (registration.state === "connected") {
          clearInterval(checkInterval);
          resolve();
        }
      }, 10);
    });
  }

  private handleWindowMessage(event: MessageEvent): void {
    if (!this.isOriginTrusted(event.origin)) {
      this.log("warn", `Message from untrusted origin: ${event.origin}`);
      return;
    }

    const registration = Array.from(this.registrations.values()).find(
      (registration) => registration.origin === event.origin && registration.state === "handshaking"
    );

    if (!registration) {
      // Not a handshake message
      return;
    }

    const envelope = event.data as IframeEnvelope;

    if (envelope.type === "pubsub:ACK") {
      this.handleAckMessage(registration, envelope as IframeAckEnvelope);
    }
  }

  private handleAckMessage(registration: IframeRegistration, ack: IframeAckEnvelope): void {
    this.log("debug", `Received ACK from ${registration.origin}: ${ack.clientId}`);

    const channel = new MessageChannel();
    registration.port = channel.port1;
    registration.clientId = ack.clientId;

    registration.port.onmessage = (event) => {
      this.handleIframeMessage(registration, event.data);
    };

    registration.port.onmessageerror = () => {
      this.log("warn", `MessagePort error for ${registration.origin}`);
      this.disconnectIframe(registration, "send_failed", false);
    };

    const ackConfirm: IframeAckConfirmEnvelope = {
      type: "pubsub:ACK_CONFIRM",
      version: PROTOCOL_VERSION,
    };

    try {
      const contentWindow = registration.iframe.contentWindow;

      if (!contentWindow) {
        throw new Error("Iframe contentWindow is null");
      }

      contentWindow.postMessage(ackConfirm, registration.origin, [channel.port2]);
      registration.state = "connected";
      this.log("info", `Connection established: ${registration.origin}`);
    } catch (error) {
      this.log("error", `Failed to send ACK_CONFIRM: ${(error as Error).message}`);
      this.disconnectIframe(registration, "handshake_failed", false);
    }
  }

  private handleIframeMessage(registration: IframeRegistration, data: unknown): void {
    const envelope = data as IframeEnvelope;

    if (envelope.type === "pubsub:MESSAGE") {
      this.handleMessageEnvelope(registration, envelope as IframeMessageEnvelope);
    } else if (envelope.type === "pubsub:DISCONNECT") {
      this.log("info", `Iframe requested disconnect: ${registration.origin}`);
      this.disconnectIframe(registration, "explicit_disconnect", false);
    }
  }

  private handleMessageEnvelope(
    registration: IframeRegistration,
    envelope: IframeMessageEnvelope
  ): void {
    this.messagesReceived++;

    const { topic, payload, schemaVersion, source } = envelope.payload;

    if (this.config.enforceSchemaValidation && schemaVersion) {
      try {
        // The bus will validate against registered schema when schemaVersion is provided
        this.bus.publish(topic, payload, {
          schemaVersion,
          source: source || `iframe:${registration.clientId}`,
        });
      } catch (error) {
        this.validationErrors++;
        this.log(
          "error",
          `Schema validation failed for iframe message: ${(error as Error).message}`
        );
        this.config.onValidationError(registration.iframe, topic, error as Error);
        return;
      }
    } else {
      this.bus.publish(topic, payload, {
        schemaVersion,
        source: source || `iframe:${registration.clientId}`,
      });
    }

    this.log("debug", `Message from iframe: ${topic}${schemaVersion ? ` (${schemaVersion})` : ""}`);
  }

  /**
   * Broadcast to all connected iframes
   */
  private handleBusMessage(message: Message): void {
    for (const registration of this.registrations.values()) {
      if (registration.state === "connected") {
        this.broadcastToIframe(registration, message);
      }
    }
  }

  private broadcastToIframe(registration: IframeRegistration, message: Message): void {
    if (!registration.port) {
      this.messagesDropped++;
      return;
    }

    const envelope: IframeMessageEnvelope = {
      type: "pubsub:MESSAGE",
      version: PROTOCOL_VERSION,
      payload: {
        messageId: message.id,
        topic: message.topic,
        payload: message.payload,
        timestamp: message.ts,
        schemaVersion: message.schemaVersion,
        source: message.meta?.source,
      },
    };

    try {
      registration.port.postMessage(envelope);
      this.messagesSent++;
      this.log("debug", `Sent to iframe ${registration.origin}: ${message.topic}`);
    } catch (error) {
      this.messagesDropped++;
      this.log("error", `Failed to send to iframe: ${(error as Error).message}`);
      this.disconnectIframe(registration, "send_failed", false);
    }
  }

  private disconnectIframe(
    registration: IframeRegistration,
    reason: DisconnectReason,
    sendDisconnect: boolean
  ): void {
    if (registration.state === "disconnected") {
      return;
    }

    this.log("info", `Disconnecting iframe: ${registration.origin} (${reason})`);

    if (sendDisconnect && registration.port) {
      const disconnect: IframeDisconnectEnvelope = {
        type: "pubsub:DISCONNECT",
        version: PROTOCOL_VERSION,
      };

      try {
        registration.port.postMessage(disconnect);
      } catch {
        // Ignore errors during disconnect
      }
    }

    if (registration.handshakeTimer) {
      clearTimeout(registration.handshakeTimer);
      registration.handshakeTimer = null;
    }

    if (registration.port) {
      registration.port.close();
      registration.port = null;
    }

    if (registration.loadListener) {
      registration.iframe.removeEventListener("load", registration.loadListener);
      registration.loadListener = null;
    }

    registration.state = "disconnected";
    registration.clientId = null;

    this.config.onIframeDisconnected(registration.iframe, reason);
  }

  private reconnectIframe(registration: IframeRegistration): void {
    if (registration.state === "connected") {
      this.log("warn", "Iframe already connected, skipping reconnect");
      return;
    }

    this.log("info", `Reconnecting iframe: ${registration.origin}`);
    registration.retryCount = 0;
    this.initiateHandshake(registration).catch((error) => {
      this.log("error", `Reconnect failed: ${(error as Error).message}`);
    });
  }

  private handleDomMutations(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
      if (mutation.type === "childList" && mutation.removedNodes.length > 0) {
        for (const node of Array.from(mutation.removedNodes)) {
          if (node instanceof HTMLIFrameElement) {
            const registration = this.registrations.get(node);

            if (registration && registration.state === "connected") {
              this.log("info", `Iframe removed from DOM: ${registration.origin}`);
              this.disconnectIframe(registration, "removed_from_dom", false);
            }
          }
        }
      }
    }
  }

  private log(level: "debug" | "info" | "warn" | "error", message: string): void {
    if (!this.config.debug && level === "debug") {
      return;
    }

    const prefix = "[IframeHost]";

    (console as Console)[level]?.(prefix, message);
  }
}
