import type { BusMetadata, PubSubBus } from "./types";

const REGISTRY_GLOBAL_KEY = "__PUBSUB_MFE_DEVTOOLS_REGISTRY__";
const REGISTRY_EVENT_NAME = "__pubsub_mfe_devtools__";

type RegistryListener = (event: RegistryEvent) => void;

export interface DevToolsRegistry {
  register(bus: PubSubBus, metadata: BusMetadata): void;
  unregister(bus: PubSubBus): void;
  getAll(): BusMetadata[];
  getBus(instanceId: string): PubSubBus | undefined;
  subscribe(callback: RegistryListener): () => void;
}

export interface RegistryEvent {
  type: "BUS_CREATED" | "BUS_DISPOSED";
  metadata: BusMetadata;
  bus?: PubSubBus;
}

interface RegistryEntry {
  busRef: WeakRef<PubSubBus>;
  metadata: BusMetadata;
}

class DevToolsRegistryImpl implements DevToolsRegistry {
  private readonly instances = new Map<string, RegistryEntry>();
  private readonly cleanup = new FinalizationRegistry<string>((instanceId) => {
    this.instances.delete(instanceId);
  });
  private readonly listeners = new Set<RegistryListener>();

  register(bus: PubSubBus, metadata: BusMetadata): void {
    this.instances.set(metadata.instanceId, {
      busRef: new WeakRef(bus),
      metadata,
    });

    this.cleanup.register(bus, metadata.instanceId, bus);
    this.emit({ type: "BUS_CREATED", metadata, bus });
  }

  unregister(bus: PubSubBus): void {
    for (const [instanceId, entry] of this.instances.entries()) {
      if (entry.busRef.deref() === bus) {
        this.instances.delete(instanceId);
        this.cleanup.unregister(bus);
        this.emit({ type: "BUS_DISPOSED", metadata: entry.metadata });
        return;
      }
    }
  }

  getAll(): BusMetadata[] {
    const metadata: BusMetadata[] = [];

    for (const [instanceId, entry] of this.instances.entries()) {
      const bus = entry.busRef.deref();

      if (!bus) {
        this.instances.delete(instanceId);
        continue;
      }

      metadata.push(entry.metadata);
    }

    return metadata;
  }

  getBus(instanceId: string): PubSubBus | undefined {
    const entry = this.instances.get(instanceId);

    if (!entry) {
      return undefined;
    }

    const bus = entry.busRef.deref();

    if (!bus) {
      this.instances.delete(instanceId);
      return undefined;
    }

    return bus;
  }

  subscribe(callback: RegistryListener): () => void {
    this.listeners.add(callback);

    return () => {
      this.listeners.delete(callback);
    };
  }

  private emit(event: RegistryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Swallow listener errors to avoid affecting app execution.
      }
    }

    if (isBrowserEnvironment()) {
      window.dispatchEvent(
        new CustomEvent(REGISTRY_EVENT_NAME, {
          detail: {
            type: event.type,
            metadata: event.metadata,
          },
        })
      );
    }
  }
}

declare global {
  interface Window {
    __PUBSUB_MFE_DEVTOOLS_REGISTRY__?: DevToolsRegistry;
  }
}

function isBrowserEnvironment(): boolean {
  return typeof window !== "undefined";
}

export function getDevToolsRegistry(): DevToolsRegistry | undefined {
  if (!isBrowserEnvironment()) {
    return undefined;
  }

  if (window.__PUBSUB_MFE_DEVTOOLS_REGISTRY__) {
    return window.__PUBSUB_MFE_DEVTOOLS_REGISTRY__;
  }

  const registry = Object.freeze(new DevToolsRegistryImpl()) as DevToolsRegistry;

  Object.defineProperty(window, REGISTRY_GLOBAL_KEY, {
    value: registry,
    writable: false,
    configurable: false,
    enumerable: false,
  });

  return registry;
}
