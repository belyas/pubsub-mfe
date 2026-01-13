const STORAGE_KEY = "__pubsub_mfe_client_id__";

/**
 * Generate a unique client ID using crypto.randomUUID() with fallback.
 *
 * Prefers native crypto.randomUUID() (RFC 4122 v4 UUID) for maximum entropy.
 * Falls back to timestamp + random for older browsers.
 *
 * @returns A unique client ID string
 *
 * @example
 * ```ts
 * const id = generateClientId();
 * // => "550e8400-e29b-41d4-a716-446655440000"
 * ```
 */
export function generateClientId(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    try {
      return globalThis.crypto.randomUUID();
      // eslint-disable-next-line no-empty
    } catch {}
  }

  // Format: "cid-{timestamp}-{random}"
  const timestamp = Date.now().toString(36);
  const random =
    Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

  return `cid-${timestamp}-${random}`;
}

/**
 * Get or create a client ID for the current tab.
 *
 * The ID is stored in sessionStorage to persist across page reloads
 * within the same tab, but is cleared when the tab closes.
 *
 * @param storage - Storage implementation
 *
 * @returns The client ID for this tab
 *
 * @example
 * ```ts
 * const clientId = getOrCreateClientId();
 * // On first call: generates new ID and stores it
 * // On subsequent calls: returns stored ID
 * ```
 */
export function getOrCreateClientId(storage: Storage = globalThis.sessionStorage): string {
  try {
    const existingId = storage.getItem(STORAGE_KEY);

    if (existingId && isValidClientId(existingId)) {
      return existingId;
    }

    const newId = generateClientId();

    storage.setItem(STORAGE_KEY, newId);
    return newId;
  } catch (_e) {
    // If storage fails (e.g., quota exceeded, privacy mode), generate ephemeral ID
    // This ID won't persist across reloads but ensures functionality
    return generateClientId();
  }
}

/**
 * Validate a client ID format.
 *
 * Accepts:
 * - RFC 4122 v4 UUIDs (from crypto.randomUUID())
 * - Legacy format: cid-{base36}-{base36}
 *
 * @param clientId - ID to validate
 *
 * @returns true if format is valid
 *
 * @example
 * ```ts
 * isValidClientId('550e8400-e29b-41d4-a716-446655440000'); // true
 * isValidClientId('cid-abc123-xyz789'); // true
 * isValidClientId('invalid'); // false
 * ```
 */
export function isValidClientId(clientId: string): boolean {
  if (!clientId || typeof clientId !== "string") {
    return false;
  }

  // RFC 4122 v4 UUID pattern
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (uuidPattern.test(clientId)) {
    return true;
  }

  // Legacy fallback pattern: cid-{base36}-{base36}
  const fallbackPattern = /^cid-[0-9a-z]+-[0-9a-z]+$/;

  return fallbackPattern.test(clientId);
}

/**
 * Clear the stored client ID for the current tab.
 *
 * Useful for testing or forcing ID regeneration.
 *
 * @param storage - Storage implementation (defaults to sessionStorage)
 *
 * @example
 * ```ts
 * clearClientId();
 * // Next call to getOrCreateClientId() will generate a new ID
 * ```
 */
export function clearClientId(storage: Storage = globalThis.sessionStorage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore errors (e.g. in restrictive environments)
  }
}
