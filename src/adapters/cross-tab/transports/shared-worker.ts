import type { CrossTabEnvelope } from "../types";
import { serializeEnvelope, deserializeEnvelope } from "../envelope";
import { BaseTransport, TransportConfig, TransportError, TransportErrorCode } from "./base";
import { generateClientId } from "../client-id";

/**
 * Message types for SharedWorker communication protocol.
 */
export enum WorkerMessageType {
  REGISTER = "register",
  REGISTERED = "registered",
  PUBLISH = "publish",
  DELIVER = "deliver",
  DISCONNECT = "disconnect",
  ERROR = "error",
  PING = "ping",
  PONG = "pong",
}

/**
 * Message structure for SharedWorker protocol.
 */
export interface WorkerMessage {
  type: WorkerMessageType;
  payload?: string;
  clientId?: string;
  error?: string;
  timestamp?: number;
}

/**
 * SharedWorker transport configuration.
 */
export interface SharedWorkerTransportConfig extends TransportConfig {
  channelName: string;
  workerUrl?: string;
  clientId?: string;
  reconnectAttempts?: number;
  reconnectDelayMs?: number;
  onFallback?: (reason: string) => void;
}

/**
 * SharedWorker transport implementation using external worker file.
 * Implements broker pattern where the worker relays messages between clients.
 * Supports reconnection with exponential backoff and fallback to other transports.
 *
 * @remarks
 * Requires a compiled worker file to be accessible. Point workerUrl to:
 * `dist/workers/cross-tab-shared-worker-broker.js`
 */
export class SharedWorkerTransport extends BaseTransport {
  readonly name = "SharedWorker";
  private worker: SharedWorker | null = null;
  private port: MessagePort | null = null;
  private readonly config: Required<
    Omit<SharedWorkerTransportConfig, "onError" | "debug" | "onFallback" | "workerUrl">
  > & {
    workerUrl?: string;
    onFallback?: (reason: string) => void;
  };
  private workerUrl: string | null;
  private isRegistered = false;
  private reconnectCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingMessages: CrossTabEnvelope[] = [];

  constructor(config: SharedWorkerTransportConfig) {
    super({ onError: config.onError, debug: config.debug ?? false });

    this.config = {
      channelName: config.channelName,
      clientId: config.clientId ?? generateClientId(),
      reconnectAttempts: config.reconnectAttempts ?? 3,
      reconnectDelayMs: config.reconnectDelayMs ?? 1000,
      workerUrl: config.workerUrl,
      onFallback: config.onFallback,
    };

    this.workerUrl = config.workerUrl ?? null;

    if (this.isAvailable()) {
      this.initialize();
    } else {
      const reason = "SharedWorker is not available in this environment";

      this.errorHandler(new TransportError(TransportErrorCode.NOT_AVAILABLE, reason));
      this.config.onFallback?.(reason);
    }
  }

  isAvailable(): boolean {
    return typeof SharedWorker !== "undefined";
  }

  isConnected(): boolean {
    return this.isRegistered && this.port !== null;
  }

  getClientId(): string {
    return this.config.clientId;
  }

  private initialize(): void {
    try {
      if (!this.workerUrl) {
        throw new Error(
          "workerUrl is required for SharedWorker transport. Point it to the compiled worker file: dist/workers/cross-tab-shared-worker-broker.js"
        );
      }

      this.worker = new SharedWorker(this.workerUrl, {
        name: `pubsub-mfe-${this.config.channelName}`,
      });
      this.port = this.worker.port;

      this.setupPortHandlers();
      this.port.start();
      this.register();
      this.debug("Initialized", {
        channelName: this.config.channelName,
        clientId: this.config.clientId,
      });
    } catch (error) {
      const reason = `Failed to create SharedWorker: ${error instanceof Error ? error.message : String(error)}`;

      this.errorHandler(
        new TransportError(
          TransportErrorCode.NOT_AVAILABLE,
          reason,
          error instanceof Error ? error : undefined
        )
      );
      this.config.onFallback?.(reason);
    }
  }

  private setupPortHandlers(): void {
    if (!this.port) {
      return;
    }

    this.port.onmessage = this.handleMessage.bind(this);
    this.port.onmessageerror = this.handleMessageError.bind(this);
  }

  private register(): void {
    if (!this.port) {
      return;
    }

    this.port.postMessage({
      type: WorkerMessageType.REGISTER,
      clientId: this.config.clientId,
      channelName: this.config.channelName,
    });

    this.debug("Registering with broker", {
      clientId: this.config.clientId,
      channelName: this.config.channelName,
    });
  }

  send(envelope: CrossTabEnvelope): void {
    if (!this.assertNotClosed("send")) {
      return;
    }

    if (!this.isRegistered) {
      this.pendingMessages.push(envelope);
      this.debug("Queued message (not yet registered)", {
        messageId: envelope.messageId,
        queueSize: this.pendingMessages.length,
      });
      return;
    }

    this.sendImmediate(envelope);
  }

  private sendImmediate(envelope: CrossTabEnvelope): void {
    if (!this.port) {
      this.errorHandler(
        new TransportError(TransportErrorCode.NOT_AVAILABLE, "SharedWorker port is not initialized")
      );
      return;
    }

    try {
      const serialized = serializeEnvelope(envelope);

      this.port.postMessage({
        type: WorkerMessageType.PUBLISH,
        payload: serialized,
        timestamp: Date.now(),
      });
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

  private flushPendingMessages(): void {
    while (this.pendingMessages.length > 0) {
      const envelope = this.pendingMessages.shift();

      if (envelope) {
        this.sendImmediate(envelope);
      }
    }
  }

  private handleMessage(event: MessageEvent<WorkerMessage>): void {
    if (this.closed) {
      return;
    }

    const message = event.data;

    switch (message.type) {
      case WorkerMessageType.REGISTERED:
        this.isRegistered = true;
        this.reconnectCount = 0;

        this.debug("Registered with broker", {
          clientId: message.clientId,
          timestamp: message.timestamp,
        });
        this.flushPendingMessages();
        break;
      case WorkerMessageType.DELIVER:
        this.handleDelivery(message);
        break;
      case WorkerMessageType.ERROR:
        this.errorHandler(
          new TransportError(TransportErrorCode.RECEIVE_FAILED, message.error || "Broker error")
        );
        break;
      case WorkerMessageType.PONG:
        this.debug("Received pong", { timestamp: message.timestamp });
        break;
    }
  }

  private handleDelivery(message: WorkerMessage): void {
    if (!message.payload) {
      this.errorHandler(
        new TransportError(TransportErrorCode.DESERIALIZATION_FAILED, "Missing payload in delivery")
      );
      return;
    }

    try {
      const envelope = deserializeEnvelope(message.payload);

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

  private handleMessageError(_event: MessageEvent): void {
    this.errorHandler(
      new TransportError(TransportErrorCode.RECEIVE_FAILED, "SharedWorker message error occurred")
    );
    this.debug("Message error");
    this.attemptReconnect();
  }

  private attemptReconnect(): void {
    if (this.closed) {
      return;
    }

    if (this.reconnectCount >= this.config.reconnectAttempts) {
      const reason = `Failed to reconnect after ${this.config.reconnectAttempts} attempts`;
      this.errorHandler(new TransportError(TransportErrorCode.NOT_AVAILABLE, reason));
      this.config.onFallback?.(reason);
      return;
    }

    this.reconnectCount++;
    this.isRegistered = false;
    const delay = this.config.reconnectDelayMs * Math.pow(2, this.reconnectCount - 1);

    this.debug("Attempting reconnect", {
      attempt: this.reconnectCount,
      maxAttempts: this.config.reconnectAttempts,
      delayMs: delay,
    });

    this.reconnectTimer = setTimeout(() => {
      this.cleanupWorker();
      this.initialize();
    }, delay);
  }

  ping(): void {
    if (!this.port || !this.isRegistered) {
      return;
    }

    this.port.postMessage({ type: WorkerMessageType.PING, timestamp: Date.now() });
  }

  private cleanupWorker(): void {
    if (this.port) {
      try {
        this.port.postMessage({ type: WorkerMessageType.DISCONNECT });
      } catch {
        // Ignore errors during cleanup
      }
      this.port.close();
      this.port = null;
    }

    this.worker = null;
    this.isRegistered = false;
  }

  protected cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.cleanupWorker();
    this.pendingMessages.length = 0;
    this.debug("Closed SharedWorker transport");
  }
}

export function createSharedWorkerTransport(
  config: SharedWorkerTransportConfig
): SharedWorkerTransport {
  return new SharedWorkerTransport(config);
}
