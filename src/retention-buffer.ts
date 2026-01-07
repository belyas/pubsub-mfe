import type { Message } from "./types.js";

/**
 * Ring buffer for efficient message retention.
 * O(1) insertion and automatic TTL-based eviction.
 */
export class RetentionRingBuffer {
  private buffer: (Message | null)[];
  private head = 0;
  private tail = 0;
  private count = 0;
  private readonly capacity: number;
  private readonly ttlMs?: number;

  constructor(capacity: number, ttlMs?: number) {
    if (capacity <= 0) {
      throw new Error("Capacity must be greater than 0.");
    }

    this.capacity = capacity;
    this.ttlMs = ttlMs;
    this.buffer = new Array(capacity).fill(null);
  }

  /**
   * Add a message to the buffer.
   * If buffer is full, oldest message is overwritten.
   */
  push(message: Message): void {
    this.buffer[this.tail] = message;
    this.tail = (this.tail + 1) % this.capacity;

    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /**
   * Get all messages, optionally filtering by TTL.
   * @param now - Current timestamp for TTL calculation
   *
   * @returns messages in insertion order (oldest first).
   */
  getMessages(now: number): Message[] {
    const result: Message[] = [];
    let idx = this.head;

    for (let i = 0; i < this.count; i++) {
      const msg = this.buffer[idx];

      if (msg !== null) {
        if (this.ttlMs === undefined || now - msg.ts <= this.ttlMs) {
          result.push(msg);
        }
      }

      idx = (idx + 1) % this.capacity;
    }

    return result;
  }

  /**
   * Clear all messages from the buffer.
   */
  clear(): void {
    this.buffer = new Array(this.capacity).fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  /**
   * Get the current number of messages in the buffer.
   */
  get size(): number {
    return this.count;
  }

  /**
   * Get the maximum capacity of the buffer.
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Get the configured TTL in milliseconds, if any.
   */
  getTtlMs(): number | undefined {
    return this.ttlMs;
  }

  /**
   * Evict expired messages from the front of the buffer.
   * Only evicts contiguous expired messages from the head.
   *
   * @param now - Current timestamp for TTL calculation
   *
   * @returns Number of messages evicted
   */
  evictExpired(now: number): number {
    if (this.ttlMs === undefined) {
      return 0;
    }

    let evicted = 0;

    while (this.count > 0) {
      const msg = this.buffer[this.head];

      if (msg === null || now - msg.ts <= this.ttlMs) {
        break;
      }

      this.buffer[this.head] = null;
      this.head = (this.head + 1) % this.capacity;
      this.count--;
      evicted++;
    }

    return evicted;
  }

  /**
   * Check if the buffer is empty.
   */
  isEmpty(): boolean {
    return this.count === 0;
  }

  /**
   * Check if the buffer is at capacity.
   */
  isFull(): boolean {
    return this.count === this.capacity;
  }

  /**
   * Peek at the oldest message without removing it.
   *
   * @returns Message | null if buffer is empty.
   */
  peekOldest(): Message | null {
    if (this.count === 0) {
      return null;
    }

    return this.buffer[this.head];
  }

  /**
   * Peek at the newest message without removing it.
   *
   * @returns Message | null if buffer is empty.
   */
  peekNewest(): Message | null {
    if (this.count === 0) {
      return null;
    }

    const newestIdx = (this.tail - 1 + this.capacity) % this.capacity;

    return this.buffer[newestIdx];
  }
}
