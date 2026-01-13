import type { CrossTabEnvelope } from "../types";
import { serializeEnvelope, deserializeEnvelope } from "../envelope";
import { BaseTransport, TransportConfig, TransportError, TransportErrorCode } from "./base";

/**
 * BroadcastChannel transport configuration.
 */
export interface BroadcastChannelTransportConfig extends TransportConfig {
  /**
   * Name of the BroadcastChannel.
   * All tabs using the same channel name will communicate.
   */
  channelName: string;
}

/**
 * BroadcastChannel transport implementation.
 */
export class BroadcastChannelTransport extends BaseTransport {
  readonly name = "BroadcastChannel";
  private channel: BroadcastChannel | null = null;
  private readonly config: BroadcastChannelTransportConfig;

  constructor(config: BroadcastChannelTransportConfig) {
    super({ onError: config?.onError, debug: config.debug ?? false });

    this.config = {
      channelName: config.channelName,
    };

    if (this.isAvailable()) {
      this.initialize();
    } else {
      this.errorHandler(
        new TransportError(
          TransportErrorCode.NOT_AVAILABLE,
          "BroadcastChannel is not available in this environment"
        )
      );
    }
  }

  /**
   * Check if BroadcastChannel is available.
   */
  isAvailable(): boolean {
    return typeof BroadcastChannel !== "undefined";
  }

  /**
   * Initialize the BroadcastChannel.
   */
  private initialize(): void {
    try {
      this.channel = new BroadcastChannel(this.config.channelName);
      this.channel.onmessage = this.handleMessage.bind(this);
      this.channel.onmessageerror = this.handleMessageError.bind(this);

      this.debug("Initialized", { channelName: this.config.channelName });
    } catch (error) {
      this.errorHandler(
        new TransportError(
          TransportErrorCode.NOT_AVAILABLE,
          `Failed to create BroadcastChannel: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  /**
   * Send an envelope to other tabs.
   */
  send(envelope: CrossTabEnvelope): void {
    if (!this.assertNotClosed("send")) {
      return;
    }

    if (!this.channel) {
      this.errorHandler(
        new TransportError(TransportErrorCode.NOT_AVAILABLE, "BroadcastChannel is not initialized")
      );
      return;
    }

    try {
      const serialized = serializeEnvelope(envelope);

      this.channel.postMessage(serialized);

      this.debug("Sent message", {
        topic: envelope.topic,
        messageId: envelope.messageId,
        size: serialized.length,
      });
    } catch (error) {
      this.errorHandler(
        new TransportError(
          TransportErrorCode.SEND_FAILED,
          `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  /**
   * Handle incoming messages from BroadcastChannel.
   */
  private handleMessage(event: MessageEvent): void {
    if (this.closed) {
      return;
    }

    try {
      const data = event.data;

      if (typeof data !== "string") {
        throw new Error("Expected string message data");
      }

      const envelope = deserializeEnvelope(data);

      this.debug("Received message", {
        topic: envelope.topic,
        messageId: envelope.messageId,
        clientId: envelope.clientId,
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

  /**
   * Handle BroadcastChannel message errors.
   */
  private handleMessageError(event: MessageEvent): void {
    this.errorHandler(
      new TransportError(
        TransportErrorCode.RECEIVE_FAILED,
        "BroadcastChannel message error occurred"
      )
    );
    this.debug("Message error", { event });
  }

  /**
   * Cleanup BroadcastChannel resources.
   */
  protected cleanup(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
      this.debug("Closed BroadcastChannel");
    }
  }
}

/**
 * Create a BroadcastChannel transport instance.
 *
 * @param config - Transport configuration
 * @returns Transport instance
 *
 * @throws {TransportError} If BroadcastChannel is not available
 */
export function createBroadcastChannelTransport(
  config: BroadcastChannelTransportConfig
): BroadcastChannelTransport {
  return new BroadcastChannelTransport(config);
}
