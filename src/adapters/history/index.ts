/**
 * History Adapter - Persistent message storage with IndexedDB.
 *
 * This adapter enables late-joiner support by persisting messages to IndexedDB,
 * allowing new tabs or components to retrieve historical messages.
 *
 * Features:
 * - IndexedDB-based persistence (shared across tabs)
 * - Wildcard topic queries
 * - Automatic garbage collection (TTL + max count)
 * - Message deduplication
 * - Tree-shakeable (lazy-loaded)
 *
 * @example
 * ```ts
 * import { createPubSub } from 'pubsub-mfe';
 * import { createHistoryAdapter } from 'pubsub-mfe/adapters/history';
 *
 * const bus = createPubSub({ app: 'my-app' });
 * const historyAdapter = createHistoryAdapter({
 *   namespace: 'my-app',
 *   maxMessages: 500,
 *   ttlSeconds: 1800,
 * });
 *
 * await historyAdapter.attach(bus);
 *
 * // Late joiner retrieves history
 * const history = await historyAdapter.getHistory('cart.#', { limit: 20 });
 *
 * // Cleanup
 * await historyAdapter.detach();
 * ```
 *
 * @packageDocumentation
 */

export type {
  HistoryAdapterConfig,
  HistoryAdapterStats,
  HistoryQueryOptions,
  StoredMessage,
  GarbageCollectionResult,
} from "./types";

/**
 * Dynamically import and create a History Adapter.
 *
 * This function uses dynamic imports to ensure the IndexedDB storage code
 * is only loaded when actually needed (tree-shakeable).
 *
 * @param config - Adapter configuration
 *
 * @returns Promise resolving to HistoryAdapter instance
 *
 * @example
 * ```ts
 * const historyAdapter = await createHistoryAdapter({
 *   namespace: 'my-app',
 *   maxMessages: 500,
 * });
 *
 * await historyAdapter.attach(bus);
 * ```
 */
export async function createHistoryAdapter(
  config?: import("./types").HistoryAdapterConfig
): Promise<import("./adapter").HistoryAdapter> {
  const { createHistoryAdapter: create } = await import("./adapter");

  return create(config);
}

// For users who want synchronous access (they accept the bundle cost)
export { HistoryAdapter, createHistoryAdapter as createHistoryAdapterSync } from "./adapter";
export { IndexedDBStorage, createIndexedDBStorage } from "./storage";
export { GarbageCollector, createGarbageCollector } from "./garbage-collector";
