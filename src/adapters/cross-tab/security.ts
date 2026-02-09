/**
 * Token bucket configuration for rate limiting.
 */
export interface RateLimitConfig {
  /** Maximum messages per second (refill rate) */
  maxPerSecond: number;
  /** Maximum burst capacity (bucket size) */
  maxBurst: number;
}

/**
 * Token bucket rate limiter implementation.
 *
 * Uses the token bucket algorithm to limit message throughput:
 * - Tokens refill at a constant rate (maxPerSecond)
 * - Bucket can hold up to maxBurst tokens
 * - Each message consumes 1 token
 * - Messages are rejected if bucket is empty
 *
 * @example
 * ```ts
 * const limiter = new RateLimiter({
 *   maxPerSecond: 100,
 *   maxBurst: 200,
 * });
 *
 * if (limiter.allowMessage()) {
 *   // Send message
 * } else {
 *   // Rate limit exceeded
 * }
 * ```
 */
export class RateLimiter {
  private readonly maxPerSecond: number;
  private readonly maxBurst: number;
  private tokens: number;
  private lastRefill: number;
  private messagesBlocked = 0;

  constructor(config: RateLimitConfig) {
    this.maxPerSecond = config.maxPerSecond;
    this.maxBurst = config.maxBurst;
    this.tokens = config.maxBurst; // Start with full bucket
    this.lastRefill = Date.now();
  }

  /**
   * Check if a message is allowed under the rate limit.
   *
   * @returns true if message is allowed, false if rate limited
   */
  allowMessage(): boolean {
    this.refillTokens();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    this.messagesBlocked++;
    return false;
  }

  /**
   * Refill tokens based on elapsed time.
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;
    const elapsedSeconds = elapsedMs / 1000;
    // Calculate tokens to add based on elapsed time
    const tokensToAdd = elapsedSeconds * this.maxPerSecond;

    if (tokensToAdd >= 1) {
      this.tokens = Math.min(this.maxBurst, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  /**
   * Get current rate limiter statistics.
   */
  getStats() {
    return {
      currentTokens: Math.floor(this.tokens),
      maxBurst: this.maxBurst,
      maxPerSecond: this.maxPerSecond,
      messagesBlocked: this.messagesBlocked,
    };
  }

  /**
   * Reset the rate limiter to initial state.
   */
  reset(): void {
    this.tokens = this.maxBurst;
    this.lastRefill = Date.now();
    this.messagesBlocked = 0;
  }
}

/**
 * Origin whitelist validator.
 *
 * Validates that message origins match allowed origins.
 * Supports exact matches and wildcard patterns.
 *
 * @example
 * ```ts
 * const validator = new OriginValidator({
 *   allowedOrigins: ['https://example.com', 'https://*.example.com'],
 * });
 *
 * validator.isAllowed('https://example.com'); // true
 * validator.isAllowed('https://sub.example.com'); // true
 * validator.isAllowed('https://evil.com'); // false
 * ```
 */
export class OriginValidator {
  private readonly allowedOrigins: string[];
  private readonly allowAny: boolean;
  /** Pre-compiled regex for each wildcard pattern, keyed by the original pattern string. */
  private readonly compiledPatterns: Map<string, RegExp>;

  constructor(config: { allowedOrigins?: string[] }) {
    this.allowedOrigins = config.allowedOrigins ?? [];
    this.allowAny = this.allowedOrigins.length === 0 || this.allowedOrigins.includes("*");

    // Pre-compile wildcard patterns once at construction time
    this.compiledPatterns = new Map();
    for (const pattern of this.allowedOrigins) {
      if (pattern.includes("*")) {
        const regexPattern = pattern
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // Escape special chars
          .replace(/\*/g, "[^/.]+"); // Replace * with non-dot, non-slash chars
        this.compiledPatterns.set(pattern, new RegExp(`^${regexPattern}$`));
      }
    }
  }

  /**
   * Check if an origin is allowed.
   *
   * @param origin - The origin to validate
   *
   * @returns true if origin is allowed, false otherwise
   */
  isAllowed(origin: string): boolean {
    if (this.allowAny) {
      return true;
    }

    if (this.allowedOrigins.includes(origin)) {
      return true;
    }

    // Check wildcard patterns (e.g., https://*.example.com)
    return this.allowedOrigins.some((pattern) => this.matchesPattern(origin, pattern));
  }

  /**
   * Match origin against a pre-compiled wildcard pattern.
   */
  private matchesPattern(origin: string, pattern: string): boolean {
    const compiled = this.compiledPatterns.get(pattern);
    if (!compiled) {
      return origin === pattern;
    }

    return compiled.test(origin);
  }
}

/**
 * Message size validator.
 *
 * Ensures messages don't exceed size limits.
 *
 * @example
 * ```ts
 * const validator = new MessageSizeValidator({ maxBytes: 256 * 1024 });
 *
 * validator.isValid(message); // true if message <= 256KB
 * ```
 */
export class MessageSizeValidator {
  private readonly maxBytes: number;

  constructor(config: { maxBytes: number }) {
    this.maxBytes = config.maxBytes;
  }

  /**
   * Check if a message is within size limits.
   *
   * @param message - The message to validate (will be JSON stringified)
   *
   * @returns true if within limits, false otherwise
   */
  isValid(message: unknown): boolean {
    const json = JSON.stringify(message);
    const bytes = new TextEncoder().encode(json).length;

    return bytes <= this.maxBytes;
  }

  /**
   * Get the size of a message in bytes.
   */
  getSize(message: unknown): number {
    const json = JSON.stringify(message);

    return new TextEncoder().encode(json).length;
  }

  /**
   * Get the maximum allowed size.
   */
  getMaxSize(): number {
    return this.maxBytes;
  }
}

/**
 * Security audit log entry.
 */
export interface SecurityEvent {
  type: "rate_limit" | "origin_blocked" | "size_exceeded" | "validation_failed";
  timestamp: number;
  origin?: string;
  size?: number;
  details?: string;
}

/**
 * Security auditor for tracking security events.
 *
 * Maintains a rolling log of security-related events.
 *
 * @example
 * ```ts
 * const auditor = new SecurityAuditor({ maxEvents: 100 });
 *
 * auditor.logEvent({
 *   type: 'rate_limit',
 *   timestamp: Date.now(),
 * });
 *
 * const recent = auditor.getRecentEvents(10);
 * ```
 */
export class SecurityAuditor {
  private readonly maxEvents: number;
  private readonly events: SecurityEvent[] = [];

  constructor(config: { maxEvents: number }) {
    this.maxEvents = config.maxEvents;
  }

  /**
   * Log a security event.
   */
  logEvent(event: SecurityEvent): void {
    this.events.push(event);

    // Keep only last N events
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  /**
   * Get recent security events.
   *
   * @param count - Number of events to return (default: all)
   */
  getRecentEvents(count?: number): SecurityEvent[] {
    if (count === undefined) {
      return [...this.events];
    }

    return this.events.slice(-count);
  }

  /**
   * Clear all logged events.
   */
  clear(): void {
    this.events.length = 0;
  }

  /**
   * Get statistics about logged events.
   */
  getStats() {
    const byType = this.events.reduce(
      (acc, event) => {
        acc[event.type] = (acc[event.type] ?? 0) + 1;

        return acc;
      },
      {} as Record<string, number>
    );

    return {
      totalEvents: this.events.length,
      byType,
    };
  }
}
