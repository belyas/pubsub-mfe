import type { Topic } from "../../types";
import { compileMatcher, matchTopic } from "../../topic-matcher";
import type { HistoryStorage, StoredMessage, HistoryQueryOptions } from "./types";

const DB_VERSION = 1;
const STORE_NAME = "messages";

/**
 * IndexedDB-based storage implementation for message history.
 *
 * Database schema:
 * - Store: "messages"
 * - Primary key: "id" (message ID)
 * - Indexes:
 *   - "by-namespace-timestamp": [namespace, timestamp] - for TTL queries and ordering
 *   - "by-namespace-topic": [namespace, topic] - for topic-based queries
 */
export class IndexedDBStorage implements HistoryStorage {
  private readonly dbName: string;
  private db: IDBDatabase | null = null;

  constructor(dbName: string) {
    this.dbName = dbName;
  }

  async open(): Promise<void> {
    if (this.db) {
      return;
    }

    return new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(this.dbName, DB_VERSION);

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        // Handle unexpected close
        this.db.onclose = () => {
          this.db = null;
        };

        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.createSchema(db);
      };
    });
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  isOpen(): boolean {
    return this.db !== null;
  }

  async put(record: StoredMessage): Promise<boolean> {
    const db = this.getDb();

    // Check for duplicate first
    const existing = await this.get(record.id);
    if (existing) {
      return false;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(record);

      request.onerror = () => {
        reject(new Error(`Failed to store message: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        resolve(true);
      };
    });
  }

  async get(id: string): Promise<StoredMessage | undefined> {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onerror = () => {
        reject(new Error(`Failed to get message: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        resolve(request.result as StoredMessage | undefined);
      };
    });
  }

  async query(
    namespace: string,
    topic: Topic,
    options: HistoryQueryOptions = {}
  ): Promise<StoredMessage[]> {
    const db = this.getDb();
    const { fromTime, limit } = options;
    const results: StoredMessage[] = [];

    // Compile the topic matcher for wildcard support
    const matcher = compileMatcher(topic);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("by-namespace-timestamp");

      // Create a range for the namespace
      // Lower bound: [namespace, fromTime or 0]
      // Upper bound: [namespace, Infinity]
      const lowerBound = [namespace, fromTime ?? 0];
      const upperBound = [namespace, Number.MAX_SAFE_INTEGER];
      const range = IDBKeyRange.bound(lowerBound, upperBound);
      const request = index.openCursor(range, "next");

      request.onerror = () => {
        reject(new Error(`Failed to query messages: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        const cursor = request.result;

        if (cursor) {
          const record = cursor.value as StoredMessage;

          // Apply topic filter using wildcard matching
          if (matchTopic(record.topic, matcher)) {
            results.push(record);
          }

          cursor.continue();
        } else {
          // Cursor exhausted - apply limit and return
          // Sort by timestamp ascending, then take last N (most recent)
          results.sort((a, b) => a.timestamp - b.timestamp);

          if (limit !== undefined && limit > 0 && results.length > limit) {
            resolve(results.slice(-limit));
          } else {
            resolve(results);
          }
        }
      };
    });
  }

  async delete(id: string): Promise<void> {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onerror = () => {
        reject(new Error(`Failed to delete message: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        resolve();
      };
    });
  }

  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);

      let hasError = false;

      tx.onerror = () => {
        if (!hasError) {
          hasError = true;
          reject(new Error(`Failed to delete messages: ${tx.error?.message}`));
        }
      };

      tx.oncomplete = () => {
        if (!hasError) {
          resolve();
        }
      };

      for (const id of ids) {
        store.delete(id);
      }
    });
  }

  async getExpired(namespace: string, beforeTimestamp: number): Promise<StoredMessage[]> {
    const db = this.getDb();
    const results: StoredMessage[] = [];

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("by-namespace-timestamp");

      // Range: [namespace, 0] to [namespace, beforeTimestamp)
      const lowerBound = [namespace, 0];
      const upperBound = [namespace, beforeTimestamp];
      const range = IDBKeyRange.bound(lowerBound, upperBound, false, true); // exclusive upper bound
      const request = index.openCursor(range);

      request.onerror = () => {
        reject(new Error(`Failed to get expired messages: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        const cursor = request.result;

        if (cursor) {
          results.push(cursor.value as StoredMessage);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
    });
  }

  async count(namespace: string): Promise<number> {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("by-namespace-timestamp");
      // Count all records in the namespace
      const lowerBound = [namespace, 0];
      const upperBound = [namespace, Number.MAX_SAFE_INTEGER];
      const range = IDBKeyRange.bound(lowerBound, upperBound);
      const request = index.count(range);

      request.onerror = () => {
        reject(new Error(`Failed to count messages: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        resolve(request.result);
      };
    });
  }

  async getOldest(namespace: string, count: number): Promise<StoredMessage[]> {
    if (count <= 0) {
      return [];
    }

    const db = this.getDb();
    const results: StoredMessage[] = [];

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("by-namespace-timestamp");
      // Range: all records in namespace, sorted by timestamp ascending
      const lowerBound = [namespace, 0];
      const upperBound = [namespace, Number.MAX_SAFE_INTEGER];
      const range = IDBKeyRange.bound(lowerBound, upperBound);
      const request = index.openCursor(range, "next");

      request.onerror = () => {
        reject(new Error(`Failed to get oldest messages: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        const cursor = request.result;

        if (cursor && results.length < count) {
          results.push(cursor.value as StoredMessage);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
    });
  }

  async clearNamespace(namespace: string): Promise<void> {
    // Get all IDs in namespace, then delete them
    const records = await this.getOldest(namespace, Number.MAX_SAFE_INTEGER);
    const ids = records.map((r: StoredMessage) => r.id);

    await this.deleteMany(ids);
  }

  private createSchema(db: IDBDatabase): void {
    // Create the messages store
    const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });

    // Index for TTL queries and timestamp-based ordering
    // Compound index: [namespace, timestamp]
    store.createIndex("by-namespace-timestamp", ["namespace", "timestamp"], { unique: false });

    // Index for topic-based queries (though we still filter by wildcard in code)
    // Compound index: [namespace, topic]
    store.createIndex("by-namespace-topic", ["namespace", "topic"], { unique: false });
  }

  private getDb(): IDBDatabase {
    if (!this.db) {
      throw new Error("IndexedDB storage is not open. Call open() first.");
    }

    return this.db;
  }
}

/**
 * Create a new IndexedDB storage instance.
 *
 * @param dbName - Database name
 *
 * @returns Storage instance (call open() before use)
 */
export function createIndexedDBStorage(dbName: string): HistoryStorage {
  return new IndexedDBStorage(dbName);
}
