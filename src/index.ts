// Factory function
export { createPubSub, __resetForTesting } from "./bus";

// Types (re-export all public types)
export type {
  // Core message types
  Message,
  MessageId,
  MessageMeta,
  Topic,
  TopicPattern,
  Timestamp,

  // Subscription types
  MessageHandler,
  SubscribeOptions,
  PublishOptions,
  Unsubscribe,

  // Schema types
  JsonSchema,
  SchemaVersion,
  ValidationMode,
  ValidationResult,
  ValidationError,

  // Configuration
  PubSubConfig,
  PubSubBus,
  RetentionConfig,
  RateLimitConfig,

  // Diagnostics
  DiagnosticEvent,
  DiagnosticHandler,
  DiagnosticPublish,
  DiagnosticSubscribe,
  DiagnosticUnsubscribe,
  DiagnosticHandlerError,
  DiagnosticValidationError,
  DiagnosticWarning,
  DiagnosticLimitExceeded,
  DiagnosticRateLimited,
} from "./types";

// Topic utilities (advanced usage)
export {
  compileMatcher,
  matchTopic,
  validatePublishTopic,
  splitTopic,
  joinTopic,
} from "./topic-matcher";

// Schema utilities (advanced usage)
export {
  registerSchema,
  getSchema,
  hasSchema,
  validatePayload,
  validateAgainstVersion,
} from "./schema-validator";

// ID utilities (advanced usage)
export { generateMessageId, getTimestamp, isValidMessageId } from "./utils";

// Retention utilities (advanced usage)
export { RetentionRingBuffer } from "./retention-buffer";

// Security & Performance utilities
export {
  // Prototype pollution prevention
  isDangerousProperty,
  hasOwnProperty,

  // ReDoS prevention
  isUnsafeRegexPattern,
  MAX_PATTERN_LENGTH,
  MAX_REGEX_TEST_STRING_LENGTH,

  // Type guards
  isPlainObject,
} from "./utils";

// Adapter types
export type { BusHooks } from "./types";
