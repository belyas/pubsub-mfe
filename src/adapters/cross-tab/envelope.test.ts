import { describe, it, expect } from "vitest";
import type { Message } from "../../types";
import type { CrossTabEnvelope, ResolvedCrossTabConfig } from "./types";
import {
  validateEnvelope,
  validateEnvelopeSize,
  validateAndSanitizeEnvelope,
  isTimestampValid,
  ENVELOPE_VERSION,
  serializeEnvelope,
  deserializeEnvelope,
  createEnvelope,
  envelopeToMessage,
} from "./envelope";

describe("Cross-Tab", () => {
  describe("SerializeEnvelope/DeserializeEnvelope", () => {
    it("should serialize and deserialize envelope", () => {
      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-abc",
        topic: "test.topic",
        payload: { value: 42 },
        timestamp: Date.now(),
        version: ENVELOPE_VERSION,
        origin: "http://localhost:3000",
      };

      const serialized = serializeEnvelope(envelope);
      expect(typeof serialized).toBe("string");

      const deserialized = deserializeEnvelope(serialized);
      expect(deserialized).toEqual(envelope);
    });

    it("should handle envelope with all optional fields", () => {
      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-abc",
        sequence: 42,
        topic: "test.topic",
        payload: { complex: { nested: { data: [1, 2, 3] } } },
        timestamp: Date.now(),
        source: "mfe-cart",
        schemaVersion: "test@1",
        meta: { custom: "metadata" },
        version: ENVELOPE_VERSION,
        origin: "http://localhost:3000",
      };

      const serialized = serializeEnvelope(envelope);
      const deserialized = deserializeEnvelope(serialized);
      expect(deserialized).toEqual(envelope);
    });

    it("should throw on invalid JSON", () => {
      expect(() => deserializeEnvelope("invalid json")).toThrow();
    });
  });

  describe("CreateEnvelope", () => {
    it("should create envelope from PubSub message", () => {
      const message: Message = {
        id: "msg-123",
        topic: "cart.item.add",
        ts: 1234567890,
        payload: { sku: "ABC", qty: 1 },
      };

      // Mock globalThis.location
      const originalLocation = globalThis.location;
      Object.defineProperty(globalThis, "location", {
        value: { origin: "http://localhost:3000" },
        writable: true,
        configurable: true,
      });

      const envelope = createEnvelope(message, "client-abc");

      expect(envelope.messageId).toBe(message.id);
      expect(envelope.clientId).toBe("client-abc");
      expect(envelope.topic).toBe(message.topic);
      expect(envelope.payload).toEqual(message.payload);
      expect(envelope.timestamp).toBe(message.ts);
      expect(envelope.version).toBe(ENVELOPE_VERSION);
      expect(envelope.origin).toBe("http://localhost:3000");
      expect(envelope.sequence).toBeUndefined();

      // Restore
      Object.defineProperty(globalThis, "location", {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    });

    it("should include sequence number when provided", () => {
      const message: Message = {
        id: "msg-123",
        topic: "test.topic",
        ts: Date.now(),
        payload: {},
      };

      const envelope = createEnvelope(message, "client-abc", 42);
      expect(envelope.sequence).toBe(42);
    });

    it("should extract source and schemaVersion from message", () => {
      const message: Message = {
        id: "msg-123",
        topic: "test.topic",
        ts: Date.now(),
        payload: {},
        schemaVersion: "test@1",
        meta: { source: "mfe-cart", custom: "value" },
      };

      const envelope = createEnvelope(message, "client-abc");
      expect(envelope.source).toBe("mfe-cart");
      expect(envelope.schemaVersion).toBe("test@1");
      expect(envelope.meta).toEqual({ source: "mfe-cart", custom: "value" });
    });
  });

  describe("EnvelopeToMessage", () => {
    it("should convert envelope back to PubSub message", () => {
      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-abc",
        topic: "cart.item.add",
        payload: { sku: "ABC" },
        timestamp: 1234567890,
        version: ENVELOPE_VERSION,
        origin: "http://localhost:3000",
      };

      const message = envelopeToMessage(envelope);

      expect(message.id).toBe(envelope.messageId);
      expect(message.topic).toBe(envelope.topic);
      expect(message.ts).toBe(envelope.timestamp);
      expect(message.payload).toEqual(envelope.payload);
      expect(message.meta?._crossTab).toBe(true);
      expect(message.meta?._sourceClientId).toBe("client-abc");
    });

    it("should include sequence in meta when present", () => {
      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-abc",
        sequence: 42,
        topic: "test.topic",
        payload: {},
        timestamp: Date.now(),
        version: ENVELOPE_VERSION,
        origin: "http://localhost:3000",
      };

      const message = envelopeToMessage(envelope);
      expect(message.meta?._sequence).toBe(42);
    });

    it("should preserve source and schemaVersion", () => {
      const envelope: CrossTabEnvelope = {
        messageId: "msg-123",
        clientId: "client-abc",
        topic: "test.topic",
        payload: {},
        timestamp: Date.now(),
        source: "mfe-cart",
        schemaVersion: "test@1",
        meta: { custom: "value" },
        version: ENVELOPE_VERSION,
        origin: "http://localhost:3000",
      };

      const message = envelopeToMessage(envelope);
      expect(message.schemaVersion).toBe("test@1");
      expect(message.meta?.source).toBe("mfe-cart");
      expect(message.meta?.custom).toBe("value");
    });
  });
});

describe("Envelope Validation", () => {
  const mockConfig: ResolvedCrossTabConfig = {
    channelName: "test-channel",
    transport: {} as any,
    clientId: "test-client",
    enableLeadership: false,
    emitSystemEvents: true,
    transportMode: "broadcast",
    maxMessageSize: 256 * 1024,
    rateLimit: { maxPerSecond: 100, maxBurst: 200 },
    expectedOrigin: "http://localhost:3000",
    dedupeWindowMs: 60000,
    dedupeCacheSize: 1000,
    enableBroker: false,
    batchIntervalMs: 10,
    maxBatchSize: 50,
    compressionThreshold: 1024,
    onError: () => {},
    debug: false,
  };

  const validEnvelope: CrossTabEnvelope = {
    messageId: "msg-123",
    clientId: "client-abc",
    topic: "test.topic",
    payload: { value: 42 },
    timestamp: Date.now(),
    version: ENVELOPE_VERSION,
    origin: "http://localhost:3000",
  };

  describe("ValidateEnvelope", () => {
    it("should validate a correct envelope", () => {
      const result = validateEnvelope(validEnvelope, mockConfig);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should reject non-object envelope", () => {
      const result = validateEnvelope("not an object", mockConfig);

      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_TYPE");
    });

    it("should reject null envelope", () => {
      const result = validateEnvelope(null, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_TYPE");
    });

    it("should reject envelope with missing messageId", () => {
      const invalid = { ...validEnvelope, messageId: undefined };
      const result = validateEnvelope(invalid, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.code).toBe("MISSING_FIELD");
      expect(result.error).toContain("messageId");
    });

    it("should reject envelope with missing clientId", () => {
      const invalid = { ...validEnvelope, clientId: undefined };
      const result = validateEnvelope(invalid, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.code).toBe("MISSING_FIELD");
    });

    it("should reject envelope with missing topic", () => {
      const invalid = { ...validEnvelope, topic: undefined };
      const result = validateEnvelope(invalid, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.code).toBe("MISSING_FIELD");
    });

    it("should reject envelope with unsupported version", () => {
      const invalid = { ...validEnvelope, version: 999 };
      const result = validateEnvelope(invalid, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_VERSION");
    });

    it("should accept envelope with different origin (origin validation is done in adapter)", () => {
      const envelope = { ...validEnvelope, origin: "http://different.com" };
      const result = validateEnvelope(envelope, mockConfig);

      // validateEnvelope only checks that origin is a string, not that it matches
      // Origin matching is done by OriginValidator in the adapter
      expect(result.valid).toBe(true);
    });

    it("should reject envelope with empty messageId", () => {
      const invalid = { ...validEnvelope, messageId: "" };
      const result = validateEnvelope(invalid, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_TYPE");
    });

    it("should reject envelope with non-string topic", () => {
      const invalid = { ...validEnvelope, topic: 123 };
      const result = validateEnvelope(invalid, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_TYPE");
    });

    it("should reject envelope with negative timestamp", () => {
      const invalid = { ...validEnvelope, timestamp: -1 };
      const result = validateEnvelope(invalid, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_TYPE");
    });

    it("should reject envelope with negative sequence", () => {
      const invalid = { ...validEnvelope, sequence: -5 };
      const result = validateEnvelope(invalid, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_TYPE");
    });

    it("should accept envelope with valid sequence", () => {
      const valid = { ...validEnvelope, sequence: 42 };
      const result = validateEnvelope(valid, mockConfig);

      expect(result.valid).toBe(true);
    });

    it("should reject envelope with non-string source", () => {
      const invalid = { ...validEnvelope, source: 123 };
      const result = validateEnvelope(invalid, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_TYPE");
    });

    it("should reject envelope with non-object meta", () => {
      const invalid = { ...validEnvelope, meta: "not an object" };
      const result = validateEnvelope(invalid, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_TYPE");
    });
  });

  describe("ValidateEnvelopeSize", () => {
    it("should accept envelope within size limit", () => {
      const result = validateEnvelopeSize(validEnvelope, 1024 * 1024);

      expect(result.valid).toBe(true);
    });

    it("should reject envelope exceeding size limit", () => {
      const largePayload = { data: "x".repeat(1024 * 300) }; // ~300KB
      const largeEnvelope = { ...validEnvelope, payload: largePayload };
      const result = validateEnvelopeSize(largeEnvelope, 256 * 1024);

      expect(result.valid).toBe(false);
      expect(result.code).toBe("MESSAGE_TOO_LARGE");
    });

    it("should handle empty payload", () => {
      const emptyEnvelope = { ...validEnvelope, payload: {} };
      const result = validateEnvelopeSize(emptyEnvelope, 1024);

      expect(result.valid).toBe(true);
    });
  });

  describe("ValidateAndSanitizeEnvelope", () => {
    it("should return validated envelope for valid data", () => {
      const result = validateAndSanitizeEnvelope(validEnvelope, mockConfig);

      expect(result).not.toBeNull();
      expect(result).toEqual(validEnvelope);
    });

    it("should return null for invalid structure", () => {
      const result = validateAndSanitizeEnvelope({ invalid: true }, mockConfig);

      expect(result).toBeNull();
    });

    it("should accept oversized envelope (size validation is done in adapter)", () => {
      const largePayload = { data: "x".repeat(1024 * 300) };
      const largeEnvelope = { ...validEnvelope, payload: largePayload };
      const result = validateAndSanitizeEnvelope(largeEnvelope, mockConfig);

      // validateAndSanitizeEnvelope no longer checks size
      // Size validation is done by MessageSizeValidator in the adapter
      expect(result).not.toBeNull();
    });

    it("should accept different origin (origin validation is done in adapter)", () => {
      const wrongOrigin = { ...validEnvelope, origin: "http://different.com" };
      const result = validateAndSanitizeEnvelope(wrongOrigin, mockConfig);

      // validateAndSanitizeEnvelope no longer validates origin matching
      // Origin validation is done by OriginValidator in the adapter
      expect(result).not.toBeNull();
    });
  });

  describe("IsTimestampValid", () => {
    it("should accept current timestamp", () => {
      const now = Date.now();

      expect(isTimestampValid(now)).toBe(true);
    });

    it("should accept recent timestamp", () => {
      const recent = Date.now() - 1000; // 1 second ago

      expect(isTimestampValid(recent)).toBe(true);
    });

    it("should reject very old timestamp", () => {
      const old = Date.now() - 400_000; // 6+ minutes ago

      expect(isTimestampValid(old, 300_000)).toBe(false);
    });

    it("should reject future timestamp", () => {
      const future = Date.now() + 120_000; // 2 minutes in future

      expect(isTimestampValid(future, 300_000, 60_000)).toBe(false);
    });

    it("should accept near-future timestamp within tolerance", () => {
      const nearFuture = Date.now() + 30_000; // 30 seconds in future

      expect(isTimestampValid(nearFuture, 300_000, 60_000)).toBe(true);
    });

    it("should use custom max age", () => {
      const old = Date.now() - 10_000; // 10 seconds ago

      expect(isTimestampValid(old, 5_000)).toBe(false); // Max age: 5 seconds
      expect(isTimestampValid(old, 15_000)).toBe(true); // Max age: 15 seconds
    });
  });
});
