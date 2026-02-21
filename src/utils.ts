import type {
  DiagnosticEvent,
  DiagnosticHandlerError,
  DiagnosticLimitExceeded,
  DiagnosticPublish,
  DiagnosticRateLimited,
  DiagnosticSubscribe,
  DiagnosticUnsubscribe,
  DiagnosticValidationError,
  DiagnosticWarning,
  MessageId,
  RegexSafetyCheck,
  SerializableError,
} from "./types";

/**
 * Properties that could enable prototype pollution attacks.
 * These are blocked in both schema definitions and payload validation.
 *
 * @see https://portswigger.net/web-security/prototype-pollution
 */
const DANGEROUS_PROPERTIES = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Maximum allowed length for regex patterns to prevent extremely long patterns.
 */
export const MAX_PATTERN_LENGTH = 256;

/**
 * Maximum allowed length for strings being tested against regex.
 * Long strings combined with complex patterns can cause exponential backtracking.
 */
export const MAX_REGEX_TEST_STRING_LENGTH = 10_000;

/**
 * Check if a property name is potentially dangerous for prototype pollution.
 *
 * @param key - Property name to check
 * @returns true if the property name could be used for prototype pollution
 *
 * @example
 * if (isDangerousProperty(key)) {
 *   throw new Error(`Property "${key}" is not allowed.`);
 * }
 */
export function isDangerousProperty(key: string): boolean {
  return DANGEROUS_PROPERTIES.has(key);
}

/**
 * Check if an object has its own property (not inherited).
 * Wrapper around Object.hasOwn() for consistency and clarity.
 *
 * @param obj - Object to check
 * @param key - Property name to look for
 * @returns true if the object has its own property with that name
 */
export function hasOwnProperty(obj: object, key: string): boolean {
  return Object.hasOwn(obj, key);
}

/**
 * Retrieve an object's own string-keyed property names (including non-enumerable).
 * Wrapper around Object.getOwnPropertyNames for clarity and centralized handling.
 * Note: does not return inherited properties or symbol-keyed properties.
 *
 * @param obj - Target object
 * @returns Array of own property names
 */
export function getOwnPropertyNames(obj: object): string[] {
  return Object.getOwnPropertyNames(obj);
}

/**
 * Safely pick specific properties from an object.
 * Only copies own properties that pass validation.
 *
 * @param source - Source object (potentially untrusted)
 * @param allowedKeys - Keys to pick
 * @param validator - Optional validator for each value
 */
export function safePick<T extends Record<string, unknown>>(
  source: unknown,
  allowedKeys: string[],
  validator?: (key: string, value: unknown) => boolean
): Partial<T> {
  const result: Partial<T> = Object.create(null);

  if (!isPlainObject(source)) {
    return result;
  }

  for (const key of allowedKeys) {
    if (isDangerousProperty(key) || !hasOwnProperty(source, key)) {
      continue;
    }

    const value = source[key];

    if (validator && !validator(key, value)) {
      continue;
    }

    result[key as keyof T] = value as T[keyof T];
  }

  return result;
}

/**
 * Check if a value is a plain object (not null, array, or other types).
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Generate a unique message ID.
 *
 * Uses crypto.randomUUID() when available (modern browsers),
 * falls back to a timestamp + random combination.
 *
 * @returns MessageId
 */
export function generateMessageId(): MessageId {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  // Fallback: timestamp + random (less collision-resistant but functional)
  return fallbackId() as MessageId;
}

/**
 * Fallback ID generation for environments without crypto.randomUUID().
 * Uses crypto.getRandomValues() for secure random bytes when available,
 * otherwise combines timestamp, counter, and Math.random() values.
 */
let fallbackCounter = 0;

function fallbackId(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.getRandomValues === "function"
  ) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    // Set version (4) and variant (8, 9, a, or b)
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Final fallback: timestamp + counter + Math.random (less secure but functional)
  const timestamp = Date.now().toString(36);
  const counter = (fallbackCounter++).toString(36);
  const random = Math.random().toString(36).slice(2, 10);

  return `${timestamp}-${counter}-${random}`;
}

/**
 * Get the current timestamp.
 */
export function getTimestamp(): number {
  return Date.now();
}

/**
 * Detect potentially dangerous regex patterns that could cause ReDoS.
 *
 * Evil Regex patterns include:
 * - Nested quantifiers: (a+)+, (a*)+, (a+)*, ([a-z]+)*
 * - Overlapping alternations: (a|aa)+, (a|a?)+
 * - Repetition of repetition groups
 *
 * @param pattern - Regex pattern string to check
 *
 * @returns Object indicating if pattern is unsafe and why
 *
 * @see https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS
 *
 * @example
 * const check = isUnsafeRegexPattern('(a+)+');
 * if (check.unsafe) {
 *   throw new Error(`Unsafe pattern: ${check.reason}`);
 * }
 */
export function isUnsafeRegexPattern(pattern: string): RegexSafetyCheck {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return {
      unsafe: true,
      reason: `Pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters.`,
    };
  }

  // Detect nested quantifiers: (...)+ or (...)* followed by + or *
  // These are the primary cause of catastrophic backtracking
  const nestedQuantifierPattern = /\([^)]*[+*][^)]*\)[+*?]|\([^)]*[+*?]\)[+*]/;
  if (nestedQuantifierPattern.test(pattern)) {
    return {
      unsafe: true,
      reason: "Pattern contains nested quantifiers which can cause catastrophic backtracking.",
    };
  }

  // Detect repetition of groups containing alternation with overlap potential
  // e.g. (a|aa)+, (a|a?)+, (ab|a)+
  const overlappingAlternation = /\([^)]*\|[^)]*\)[+*]/;
  if (overlappingAlternation.test(pattern)) {
    // More specific check for truly overlapping patterns
    const groupMatch = pattern.match(/\(([^)]+)\)[+*]/g);
    if (groupMatch) {
      for (const group of groupMatch) {
        const inner = group.slice(1, -2); // Remove ( and )+/*
        const alternatives = inner.split("|");
        // Check if any alternative is a prefix of another (overlap)
        for (let i = 0; i < alternatives.length; i++) {
          for (let j = 0; j < alternatives.length; j++) {
            if (i !== j && alternatives[j].startsWith(alternatives[i])) {
              return {
                unsafe: true,
                reason:
                  "Pattern contains overlapping alternations which can cause catastrophic backtracking",
              };
            }
          }
        }
      }
    }
  }

  // Detect character class with quantifier inside repeated group
  // e.g. ([a-z]+)+, (\w+)+, (\d*)+
  const charClassQuantifierInGroup =
    /\(\[[^\]]*\][+*][^)]*\)[+*]|\([^)]*[+*][^)]*\[[^\]]*\][^)]*\)[+*]/;
  if (charClassQuantifierInGroup.test(pattern)) {
    return {
      unsafe: true,
      reason: "Pattern contains character class with quantifier in repeated group",
    };
  }

  // Detect common evil patterns
  const evilPatterns: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /\(\.\*\)[+*]/, reason: "(.*)+  or (.*)* pattern" },
    { pattern: /\(\.\+\)[+*]/, reason: "(.+)+  or (.+)* pattern" },
    { pattern: /\(\\s\+\)[+*]/, reason: "(\\s+)+ or (\\s+)* pattern" },
    { pattern: /\(\\w\+\)[+*]/, reason: "(\\w+)+ or (\\w+)* pattern" },
    { pattern: /\(\\d\+\)[+*]/, reason: "(\\d+)+ or (\\d+)* pattern" },
  ];

  for (const evil of evilPatterns) {
    if (evil.pattern.test(pattern)) {
      return {
        unsafe: true,
        reason: `Pattern contains a known evil regex pattern: ${evil.reason}`,
      };
    }
  }

  return { unsafe: false };
}

/**
 * Validate that a string is a valid MessageId format.
 * Useful for debugging and testing.
 */
export function isValidMessageId(id: string): id is MessageId {
  if (!id || typeof id !== "string") return false;

  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  // Fallback format: timestamp-counter-random (e.g., "1a2b3c4d-0-abc123xy")
  const fallbackRegex = /^[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/i;

  return uuidRegex.test(id) || fallbackRegex.test(id);
}

/**
 * Serializable version of a DiagnosticEvent.
 * Replaces Error objects with SerializableError for safe postMessage/JSON.
 */
export type SerializableDiagnosticEvent =
  | DiagnosticPublish
  | DiagnosticSubscribe
  | DiagnosticUnsubscribe
  | (Omit<DiagnosticHandlerError, "error"> & { error: SerializableError })
  | DiagnosticValidationError
  | DiagnosticWarning
  | DiagnosticLimitExceeded
  | DiagnosticRateLimited;

/**
 * Serialize an Error object for safe transmission.
 * Preserves name, message, and stack trace.
 */
export function serializeError(error: Error): SerializableError {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

/**
 * Serialize a diagnostic event for DevTools.
 * Replaces Error objects with serializable versions.
 */
export function serializeDiagnosticEvent(event: DiagnosticEvent): SerializableDiagnosticEvent {
  if (event.type === "handler-error") {
    return {
      ...event,
      error: serializeError(event.error),
    };
  }

  return event;
}
