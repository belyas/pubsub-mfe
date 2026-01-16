import type { Message } from "../../types";
import type {
  CrossTabEnvelope,
  EnvelopeValidationResult,
  EnvelopeValidationErrorCode,
  ResolvedCrossTabConfig,
  ClientId,
  DedupeKey,
  SequenceNumber,
} from "./types";

/**
 * Cross-tab message envelope version.
 * Allows for future protocol evolution with backward compatibility.
 */
export const ENVELOPE_VERSION = 1;

/**
 * Serializes a CrossTabEnvelope to string (JSON).
 */
export function serializeEnvelope(envelope: CrossTabEnvelope): string {
  return JSON.stringify(envelope);
}

/**
 * Deserializes a string to CrossTabEnvelope.
 * Throws if the string is not valid JSON.
 */
export function deserializeEnvelope(data: string): CrossTabEnvelope {
  return JSON.parse(data) as CrossTabEnvelope;
}

/**
 * Creates a CrossTabEnvelope from a PubSub Message.
 */
export function createEnvelope<T = unknown>(
  message: Message<T>,
  clientId: ClientId,
  sequence?: SequenceNumber
): CrossTabEnvelope<T> {
  return {
    messageId: message.id,
    clientId,
    sequence,
    topic: message.topic,
    payload: message.payload,
    timestamp: message.ts,
    source: message.meta?.source as string | undefined,
    schemaVersion: message.schemaVersion,
    meta: message.meta,
    version: ENVELOPE_VERSION,
    origin: globalThis.location?.origin || "",
  };
}

/**
 * Creates a deduplication key from message ID and client ID.
 */
export function createDedupeKey(messageId: string, clientId: ClientId): DedupeKey {
  return `${messageId}:${clientId}`;
}

/**
 * Converts a CrossTabEnvelope back to a PubSub Message.
 */
export function envelopeToMessage<T = unknown>(envelope: CrossTabEnvelope<T>): Message<T> {
  return {
    id: envelope.messageId,
    topic: envelope.topic,
    ts: envelope.timestamp,
    payload: envelope.payload,
    schemaVersion: envelope.schemaVersion,
    meta: {
      ...envelope.meta,
      source: envelope.source,
      // Mark as cross-tab message
      _crossTab: true,
      _sourceClientId: envelope.clientId,
      _sequence: envelope.sequence,
    },
  };
}

/**
 * Validates a cross-tab envelope.
 *
 * Checks:
 * 1. Required fields are present
 * 2. Version is supported
 * 3. Origin matches expected origin
 * 4. Message size is within limits
 * 5. Field types are correct
 *
 * @param envelope - Envelope to validate
 * @param config - Adapter configuration
 *
 * @returns Validation result
 */
export function validateEnvelope(
  envelope: unknown,
  _config: ResolvedCrossTabConfig
): EnvelopeValidationResult {
  if (!envelope || typeof envelope !== "object") {
    return {
      valid: false,
      error: "Envelope must be an object",
      code: "INVALID_TYPE" as EnvelopeValidationErrorCode,
    };
  }

  const env = envelope as Partial<CrossTabEnvelope>;
  const requiredFields: Array<keyof CrossTabEnvelope> = [
    "messageId",
    "clientId",
    "topic",
    "payload",
    "timestamp",
    "version",
    "origin",
  ];

  for (const field of requiredFields) {
    if (!(field in env) || env[field] === undefined || env[field] === null) {
      return {
        valid: false,
        error: `Missing required field: ${field}`,
        code: "MISSING_FIELD" as EnvelopeValidationErrorCode,
      };
    }
  }

  if (env.version !== ENVELOPE_VERSION) {
    return {
      valid: false,
      error: `Unsupported envelope version: ${env.version} (expected: ${ENVELOPE_VERSION})`,
      code: "INVALID_VERSION" as EnvelopeValidationErrorCode,
    };
  }

  // Note: Origin validation is done separately by OriginValidator in the adapter
  // Here we just check that origin field exists and is a string
  if (typeof env.origin !== "string" || env.origin.length === 0) {
    return {
      valid: false,
      error: "origin must be a non-empty string",
      code: "INVALID_TYPE" as EnvelopeValidationErrorCode,
    };
  }

  if (typeof env.messageId !== "string" || env.messageId.length === 0) {
    return {
      valid: false,
      error: "messageId must be a non-empty string",
      code: "INVALID_TYPE" as EnvelopeValidationErrorCode,
    };
  }

  if (typeof env.clientId !== "string" || env.clientId.length === 0) {
    return {
      valid: false,
      error: "clientId must be a non-empty string",
      code: "INVALID_TYPE" as EnvelopeValidationErrorCode,
    };
  }

  if (typeof env.topic !== "string" || env.topic.length === 0) {
    return {
      valid: false,
      error: "topic must be a non-empty string",
      code: "INVALID_TYPE" as EnvelopeValidationErrorCode,
    };
  }

  if (typeof env.timestamp !== "number" || env.timestamp <= 0) {
    return {
      valid: false,
      error: "timestamp must be a positive number",
      code: "INVALID_TYPE" as EnvelopeValidationErrorCode,
    };
  }

  if (env.sequence !== undefined) {
    if (typeof env.sequence !== "number" || env.sequence < 0) {
      return {
        valid: false,
        error: "sequence must be a non-negative number",
        code: "INVALID_TYPE" as EnvelopeValidationErrorCode,
      };
    }
  }

  if (env.source !== undefined && typeof env.source !== "string") {
    return {
      valid: false,
      error: "source must be a string",
      code: "INVALID_TYPE" as EnvelopeValidationErrorCode,
    };
  }

  if (env.schemaVersion !== undefined && typeof env.schemaVersion !== "string") {
    return {
      valid: false,
      error: "schemaVersion must be a string",
      code: "INVALID_TYPE" as EnvelopeValidationErrorCode,
    };
  }

  if (env.meta !== undefined && (typeof env.meta !== "object" || env.meta === null)) {
    return {
      valid: false,
      error: "meta must be an object",
      code: "INVALID_TYPE" as EnvelopeValidationErrorCode,
    };
  }

  return { valid: true };
}

/**
 * Checks if an envelope's serialized size exceeds the limit.
 *
 * @param envelope - Envelope to check
 * @param maxSize - Maximum size in bytes
 *
 * @returns Validation result
 */
export function validateEnvelopeSize(
  envelope: CrossTabEnvelope,
  maxSize: number
): EnvelopeValidationResult {
  // Estimate size using JSON serialization
  // This is conservative (actual transmission may be smaller with compression)
  const serialized = JSON.stringify(envelope);
  const sizeInBytes = new Blob([serialized]).size;

  if (sizeInBytes > maxSize) {
    return {
      valid: false,
      error: `Message too large: ${sizeInBytes} bytes (max: ${maxSize} bytes)`,
      code: "MESSAGE_TOO_LARGE" as EnvelopeValidationErrorCode,
    };
  }

  return { valid: true };
}

/**
 * Validates and sanitizes an incoming envelope.
 *
 * Combines all validation checks and returns a validated envelope
 * or null if validation fails.
 *
 * @param data - Raw envelope data (from transport)
 * @param config - Adapter configuration
 *
 * @returns Validated envelope or null
 */
export function validateAndSanitizeEnvelope(
  data: unknown,
  config: ResolvedCrossTabConfig
): CrossTabEnvelope | null {
  const structureResult = validateEnvelope(data, config);

  if (!structureResult.valid) {
    return null;
  }

  const envelope = data as CrossTabEnvelope;

  // Note: Size validation is done separately by MessageSizeValidator in the adapter
  // This allows for more detailed security tracking and stats

  // Return validated envelope
  // Note: We don't clone the envelope here for performance.
  // The caller should not mutate the envelope.
  return envelope;
}

/**
 * Checks if a timestamp is within an acceptable range (not too old, not in future).
 *
 * Helps detect clock skew or replay attacks.
 *
 * @param timestamp - Message timestamp
 * @param maxAgeMs - Maximum age in milliseconds (default: 5 minutes)
 * @param maxFutureMs - Maximum future time in milliseconds (default: 1 minute)
 *
 * @returns true if timestamp is acceptable
 */
export function isTimestampValid(
  timestamp: number,
  maxAgeMs: number = 300_000,
  maxFutureMs: number = 60_000
): boolean {
  const now = Date.now();
  const age = now - timestamp;

  if (age > maxAgeMs) {
    return false;
  }

  // Reject messages from the future (clock skew or malicious)
  if (age < -maxFutureMs) {
    return false;
  }

  return true;
}
