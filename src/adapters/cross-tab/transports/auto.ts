import type { Transport, TransportConfig } from "./base";
import { BroadcastChannelTransport } from "./broadcast-channel";
import { SharedWorkerTransport } from "./shared-worker";
import { StorageTransport } from "./storage";

/**
 * Transport type identifiers.
 */
export type TransportType = "sharedworker" | "broadcast-channel" | "storage";

/**
 * Options for auto-selecting a transport.
 */
export interface AutoTransportOptions extends TransportConfig {
  channelName: string;
  clientId?: string;
  preferredMode?: TransportType;
  onFallback?: (from: TransportType, to: TransportType, reason: string) => void;
  sharedWorkerUrl?: string;
  storageTtlMs?: number;
  storageMaxMessages?: number;
}

/**
 * Result of transport creation including metadata.
 */
export interface AutoTransportResult {
  transport: Transport;
  type: TransportType;
  fallbackChain: TransportType[];
}

/**
 * Default fallback order: SharedWorker → BroadcastChannel → Storage
 */
const DEFAULT_FALLBACK_ORDER: TransportType[] = ["sharedworker", "broadcast-channel", "storage"];

/**
 * Check if SharedWorker is available in the current environment.
 */
export function isSharedWorkerAvailable(): boolean {
  return typeof SharedWorker !== "undefined";
}

/**
 * Check if BroadcastChannel is available in the current environment.
 */
export function isBroadcastChannelAvailable(): boolean {
  return typeof BroadcastChannel !== "undefined";
}

/**
 * Check if Storage (localStorage) is available in the current environment.
 */
export function isStorageAvailable(): boolean {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return false;
  }

  try {
    const testKey = `__storage_test_${Date.now()}`;

    localStorage.setItem(testKey, "test");
    localStorage.removeItem(testKey);

    return true;
  } catch {
    return false;
  }
}

/**
 * Get the best available transport type based on browser capabilities.
 */
export function getBestAvailableTransport(preferred?: TransportType): TransportType | null {
  const fallbackOrder = preferred
    ? [preferred, ...DEFAULT_FALLBACK_ORDER.filter((t) => t !== preferred)]
    : DEFAULT_FALLBACK_ORDER;

  for (const type of fallbackOrder) {
    switch (type) {
      case "sharedworker":
        if (isSharedWorkerAvailable()) return type;
        break;
      case "broadcast-channel":
        if (isBroadcastChannelAvailable()) return type;
        break;
      case "storage":
        if (isStorageAvailable()) return type;
        break;
    }
  }

  return null;
}

/**
 * Create a transport of the specified type.
 */
function createTransportOfType(type: TransportType, options: AutoTransportOptions): Transport {
  switch (type) {
    case "sharedworker":
      return new SharedWorkerTransport({
        channelName: options.channelName,
        clientId: options.clientId,
        workerUrl: options.sharedWorkerUrl,
        onError: options.onError,
        debug: options.debug,
        onFallback: (reason) => {
          options.onFallback?.("sharedworker", "broadcast-channel", reason);
        },
      });
    case "broadcast-channel":
      return new BroadcastChannelTransport({
        channelName: options.channelName,
        onError: options.onError,
        debug: options.debug,
      });
    case "storage":
      return new StorageTransport({
        channelName: options.channelName,
        clientId: options.clientId,
        ttlMs: options.storageTtlMs,
        maxMessages: options.storageMaxMessages,
        onError: options.onError,
        debug: options.debug,
      });
    default:
      throw new Error(`Unknown transport type: ${type}`);
  }
}

/**
 * Create a transport with automatic fallback based on browser capabilities.
 *
 * Fallback order: SharedWorker → BroadcastChannel → Storage
 *
 * @example
 * ```typescript
 * const { transport, type } = createAutoTransport({
 *   channelName: 'my-app',
 *   onFallback: (from, to, reason) => {
 *     console.log(`Fell back from ${from} to ${to}: ${reason}`);
 *   },
 * });
 * ```
 */
export function createAutoTransport(options: AutoTransportOptions): AutoTransportResult {
  const fallbackOrder = options.preferredMode
    ? [options.preferredMode, ...DEFAULT_FALLBACK_ORDER.filter((t) => t !== options.preferredMode)]
    : [...DEFAULT_FALLBACK_ORDER];

  const fallbackChain: TransportType[] = [];
  let lastError: Error | null = null;

  for (let i = 0; i < fallbackOrder.length; i++) {
    const type = fallbackOrder[i];
    fallbackChain.push(type);

    const isAvailable = (() => {
      switch (type) {
        case "sharedworker":
          return isSharedWorkerAvailable();
        case "broadcast-channel":
          return isBroadcastChannelAvailable();
        case "storage":
          return isStorageAvailable();
        default:
          return false;
      }
    })();

    if (!isAvailable) {
      const reason = `${type} is not available in this environment`;

      if (i > 0) {
        options.onFallback?.(fallbackOrder[i - 1], type, reason);
      }
      continue;
    }

    try {
      const transport = createTransportOfType(type, options);

      // Verify the transport is actually available after construction
      if (!transport.isAvailable()) {
        const reason = `${type} transport reported not available after construction`;

        if (i < fallbackOrder.length - 1) {
          options.onFallback?.(type, fallbackOrder[i + 1], reason);
        }
        continue;
      }

      return {
        transport,
        type,
        fallbackChain,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const reason = `Failed to create ${type} transport: ${lastError.message}`;

      if (i < fallbackOrder.length - 1) {
        options.onFallback?.(type, fallbackOrder[i + 1], reason);
      }
    }
  }

  throw new Error(
    `No transport available. Tried: ${fallbackChain.join(" → ")}. Last error: ${lastError?.message ?? "unknown"}`
  );
}

/**
 * Create a transport with explicit type selection (no automatic fallback).
 *
 * @throws Error if the specified transport type is not available
 */
export function createTransport(
  type: TransportType,
  options: Omit<AutoTransportOptions, "preferredMode" | "onFallback">
): Transport {
  const isAvailable = (() => {
    switch (type) {
      case "sharedworker":
        return isSharedWorkerAvailable();
      case "broadcast-channel":
        return isBroadcastChannelAvailable();
      case "storage":
        return isStorageAvailable();
      default:
        return false;
    }
  })();

  if (!isAvailable) {
    throw new Error(`Transport "${type}" is not available in this environment`);
  }

  return createTransportOfType(type, { ...options, preferredMode: type });
}

/**
 * Get information about available transports in the current environment.
 */
export function getAvailableTransports(): Record<TransportType, boolean> {
  return {
    sharedworker: isSharedWorkerAvailable(),
    "broadcast-channel": isBroadcastChannelAvailable(),
    storage: isStorageAvailable(),
  };
}
