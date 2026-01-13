import type { CrossTabEnvelope } from "../types";

/**
 * Transport layer interface.
 *
 * All transport implementations must conform to this interface.
 */
export interface Transport {
  /**
   * Send an envelope to other tabs.
   *
   * @param envelope - Envelope to broadcast
   *
   * @throws {Error} If transport is closed or send fails
   */
  send(envelope: CrossTabEnvelope): void;

  /**
   * Register a handler for incoming envelopes.
   *
   * Multiple handlers can be registered. All will be called for each incoming message.
   *
   * @param handler - Function to call when envelope is received
   *
   * @returns Unsubscribe function to remove the handler
   */
  onMessage(handler: (envelope: CrossTabEnvelope) => void): () => void;

  /**
   * Close the transport and cleanup resources.
   *
   * After closing, send() and onMessage() should throw errors.
   * Any registered handlers are automatically removed.
   */
  close(): void;

  /**
   * Check if the transport is available in the current environment.
   *
   * @returns true if the transport can be used
   */
  isAvailable(): boolean;

  /**
   * Get the transport name for debugging.
   */
  readonly name: string;
}

/**
 * Transport error types.
 */
export enum TransportErrorCode {
  NOT_AVAILABLE = "NOT_AVAILABLE",
  ALREADY_CLOSED = "ALREADY_CLOSED",
  SEND_FAILED = "SEND_FAILED",
  RECEIVE_FAILED = "RECEIVE_FAILED",
  SERIALIZATION_FAILED = "SERIALIZATION_FAILED",
  DESERIALIZATION_FAILED = "DESERIALIZATION_FAILED",
}

/**
 * Transport-specific error class.
 */
export class TransportError extends Error {
  constructor(
    public readonly code: TransportErrorCode,
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "TransportError";
  }
}

/**
 * Transport configuration.
 */
export interface TransportConfig {
  /**
   * Error handler for transport errors.
   */
  onError?: (error: Error) => void | undefined;

  /**
   * Enable debug logging.
   */
  debug?: boolean;
}

/**
 * Base transport class with common functionality.
 *
 * Provides handler management and error handling utilities.
 */
export abstract class BaseTransport implements Transport {
  protected handlers = new Set<(envelope: CrossTabEnvelope) => void>();
  protected closed = false;
  private baseConfig: TransportConfig;
  abstract readonly name: string;

  constructor(config: TransportConfig = {}) {
    this.baseConfig = config;
  }

  /**
   * Send an envelope to other tabs.
   */
  abstract send(envelope: CrossTabEnvelope): void;

  /**
   * Check if the transport is available.
   */
  abstract isAvailable(): boolean;

  /**
   * Cleanup transport-specific resources.
   */
  protected abstract cleanup(): void;

  /**
   * Register a message handler.
   */
  onMessage(handler: (envelope: CrossTabEnvelope) => void): () => void {
    if (this.closed) {
      this.errorHandler(
        new TransportError(
          TransportErrorCode.ALREADY_CLOSED,
          `Cannot register handler: ${this.name} transport is closed`
        )
      );

      return () => {};
    }

    this.handlers.add(handler);

    return () => {
      this.handlers.delete(handler);
    };
  }

  /**
   * Dispatch an envelope to all registered handlers.
   *
   * Errors in handlers are caught and logged to prevent cascading failures.
   */
  protected dispatch(envelope: CrossTabEnvelope): void {
    for (const handler of this.handlers) {
      try {
        handler(envelope);
      } catch (error) {
        this.errorHandler(
          new TransportError(
            TransportErrorCode.RECEIVE_FAILED,
            `Failed to dispatch message: ${error instanceof Error ? error.message : String(error)}`,
            error instanceof Error ? error : undefined
          )
        );
      }
    }
  }

  /**
   * Close the transport.
   */
  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.handlers.clear();
    this.cleanup();
  }

  /**
   * Handle transport errors.
   */
  protected errorHandler(error: TransportError): void {
    if (this.baseConfig.onError) {
      this.baseConfig.onError(error);
    }

    if (this.baseConfig.debug) {
      console.error(`[${this.name}] transport error`, { error });
    }
  }

  /**
   * Debug logging helper.
   */
  protected debug(message: string, data?: Record<string, unknown>): void {
    if (this.baseConfig.debug) {
      console.debug(`[${this.name}] ${message}`, data ?? "");
    }
  }

  /**
   * Assert that the transport is not closed.
   */
  protected assertNotClosed(operation: string): boolean {
    if (this.closed) {
      this.errorHandler(
        new TransportError(
          TransportErrorCode.ALREADY_CLOSED,
          `Cannot ${operation}: ${this.name} transport is closed`
        )
      );
      return false;
    }

    return true;
  }
}
