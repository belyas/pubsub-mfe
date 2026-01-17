export { CrossTabAdapter, createCrossTabAdapter } from "./adapter";

export { BroadcastChannelTransport } from "./transports/broadcast-channel";

export type {
  CrossTabAdapterConfig,
  CrossTabStats,
  CrossTabEnvelope,
  Transport,
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
