/**
 * Disconnect reasons for iframe communication.
 */
export type DisconnectReason =
  | "send_failed" // MessagePort.postMessage() threw error
  | "removed_from_dom" // Host detected iframe no longer in DOM
  | "explicit_disconnect" // Iframe sent DISCONNECT message
  | "timeout" // Handshake timeout
  | "handshake_failed"; // Handshake failed after retries

/**
 * Configuration for IframeHost adapter.
 */
export interface IframeHostConfig {
  /**
   * Trusted origins that can communicate with this host.
   * Messages from other origins are rejected.
   */
  trustedOrigins: string[];

  /**
   * Timeout for handshake completion (ms).
   * Default: 5000 (5 seconds)
   */
  handshakeTimeout?: number;

  /**
   * Maximum handshake retry attempts.
   * Default: 2
   */
  maxRetries?: number;

  /**
   * Auto-reconnect on iframe reload.
   * Default: true
   */
  autoReconnect?: boolean;

  /**
   * Enforce schema validation for messages from iframes.
   * When true, messages without valid schemas are rejected.
   * Default: false
   */
  enforceSchemaValidation?: boolean;

  /**
   * Enable debug logging.
   * Default: false
   */
  debug?: boolean;

  /**
   * Called when iframe handshake completes successfully.
   */
  onHandshakeComplete?: (iframe: HTMLIFrameElement, clientId: string) => void;

  /**
   * Called when iframe handshake fails after retries.
   */
  onHandshakeFailed?: (iframe: HTMLIFrameElement, origin: string, error: Error) => void;

  /**
   * Called when iframe disconnects.
   */
  onIframeDisconnected?: (iframe: HTMLIFrameElement, reason: DisconnectReason) => void;

  /**
   * Called when a message from iframe fails schema validation.
   */
  onValidationError?: (iframe: HTMLIFrameElement, topic: string, error: Error) => void;
}

/**
 * Internal registration state for an iframe.
 */
export interface IframeRegistration {
  iframe: HTMLIFrameElement;
  origin: string;
  port: MessagePort | null;
  clientId: string | null;
  state: "pending" | "handshaking" | "connected" | "disconnected";
  retryCount: number;
  handshakeTimer: ReturnType<typeof setTimeout> | null;
  loadListener: (() => void) | null;
}

/**
 * Message envelope types for iframe communication.
 */
export type IframeEnvelopeType =
  | "pubsub:SYN"
  | "pubsub:ACK"
  | "pubsub:ACK_CONFIRM"
  | "pubsub:MESSAGE"
  | "pubsub:DISCONNECT";

/**
 * Base envelope for iframe messages.
 */
export interface IframeEnvelopeBase {
  type: IframeEnvelopeType;
  version: number;
}

/**
 * SYN message from host to iframe (initiate handshake).
 */
export interface IframeSynEnvelope extends IframeEnvelopeBase {
  type: "pubsub:SYN";
}

/**
 * ACK message from iframe to host (handshake response).
 */
export interface IframeAckEnvelope extends IframeEnvelopeBase {
  type: "pubsub:ACK";
  clientId: string;
  capabilities: string[];
}

/**
 * ACK_CONFIRM message from host to iframe (complete handshake with port).
 */
export interface IframeAckConfirmEnvelope extends IframeEnvelopeBase {
  type: "pubsub:ACK_CONFIRM";
}

/**
 * MESSAGE envelope for pub/sub messages.
 */
export interface IframeMessageEnvelope extends IframeEnvelopeBase {
  type: "pubsub:MESSAGE";
  payload: {
    messageId: string;
    topic: string;
    payload: unknown;
    timestamp: number;
    schemaVersion?: string;
    source?: string;
  };
}

/**
 * DISCONNECT message (graceful shutdown).
 */
export interface IframeDisconnectEnvelope extends IframeEnvelopeBase {
  type: "pubsub:DISCONNECT";
}

/**
 * Union type for all iframe envelopes.
 */
export type IframeEnvelope =
  | IframeSynEnvelope
  | IframeAckEnvelope
  | IframeAckConfirmEnvelope
  | IframeMessageEnvelope
  | IframeDisconnectEnvelope;

/**
 * Statistics for IframeHost adapter.
 */
export interface IframeHostStats {
  /**
   * Total iframes registered.
   */
  totalIframes: number;

  /**
   * Iframes currently connected.
   */
  connectedIframes: number;

  /**
   * Total messages sent to iframes.
   */
  messagesSent: number;

  /**
   * Total messages received from iframes.
   */
  messagesReceived: number;

  /**
   * Handshakes failed.
   */
  handshakesFailed: number;

  /**
   * Messages dropped due to disconnected iframe.
   */
  messagesDropped: number;

  /**
   * Messages that failed schema validation.
   */
  validationErrors: number;
}

/**
 * Configuration for IframeClient adapter.
 */
export interface IframeClientConfig {
  /**
   * Expected origin of the host application.
   * Messages from other origins are rejected.
   */
  expectedHostOrigin: string;

  /**
   * Timeout for handshake completion (ms).
   * Default: 5000
   */
  handshakeTimeout?: number;

  /**
   * Auto-reconnect if disconnected.
   * Default: true
   */
  autoReconnect?: boolean;

  /**
   * Enable debug logging.
   * Default: false
   */
  debug?: boolean;

  /**
   * Called when connection to host is established.
   */
  onConnected?: (hostClientId: string) => void;

  /**
   * Called when disconnected from host.
   */
  onDisconnected?: (reason: DisconnectReason) => void;
}

/**
 * Statistics for IframeClient adapter.
 */
export interface IframeClientStats {
  /**
   * Connection state.
   */
  connected: boolean;

  /**
   * Total messages published to host.
   */
  messagesPublished: number;

  /**
   * Total messages received from host.
   */
  messagesReceived: number;

  /**
   * Connection attempts.
   */
  connectionAttempts: number;

  /**
   * Disconnections.
   */
  disconnections: number;
}
