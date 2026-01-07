import { MessageId } from "./types";

/**
 * Properties that could enable prototype pollution attacks.
 * These are blocked in both schema definitions and payload validation.
 *
 * @see https://portswigger.net/web-security/prototype-pollution
 */
const DANGEROUS_PROPERTIES = new Set(["__proto__", "constructor", "prototype"]);

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
  if (typeof window.crypto !== "undefined" && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
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
  if (typeof window.crypto !== "undefined" && typeof window.crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
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
