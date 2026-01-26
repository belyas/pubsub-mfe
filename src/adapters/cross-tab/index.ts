export { CrossTabAdapter, createCrossTabAdapter } from "./adapter";

export { BroadcastChannelTransport } from "./transports/broadcast-channel";
export {
  SharedWorkerTransport,
  createSharedWorkerTransport,
  WorkerMessageType,
} from "./transports/shared-worker";
export { StorageTransport, createStorageTransport } from "./transports/storage";
export {
  createAutoTransport,
  createTransport,
  getBestAvailableTransport,
  getAvailableTransports,
  isSharedWorkerAvailable,
  isBroadcastChannelAvailable,
  isStorageAvailable,
} from "./transports/auto";

export type { Transport } from "./types";
export type { BroadcastChannelTransportConfig } from "./transports/broadcast-channel";
export type { SharedWorkerTransportConfig, WorkerMessage } from "./transports/shared-worker";
export type { StorageTransportConfig } from "./transports/storage";
export type { TransportType, AutoTransportOptions, AutoTransportResult } from "./transports/auto";

export type {
  CrossTabAdapterConfig,
  CrossTabStats,
  CrossTabEnvelope,
  ClientId,
  DedupeKey,
  EnvelopeValidationResult,
  EnvelopeValidationErrorCode,
  ResolvedCrossTabConfig,
} from "./types";

export { getOrCreateClientId, generateClientId } from "./client-id";
export { DeduplicationCache } from "./deduplication";
export { LeadershipDetector } from "./leadership";
export {
  validateAndSanitizeEnvelope,
  ENVELOPE_VERSION,
  createEnvelope,
  validateEnvelope,
} from "./envelope";

export { RateLimiter, OriginValidator, MessageSizeValidator, SecurityAuditor } from "./security";
export type { RateLimitConfig, SecurityEvent } from "./security";

export { MessageBatcher, createMessageBatcher } from "./batching";
export type { BatchingConfig, BatchingConfigWithFlush } from "./batching";
