import { afterEach, describe, expect, it, vi } from "vitest";
import { getDevToolsRegistry } from "./devtools-registry";
import type { BusMetadata, PubSubBus } from "./types";

const REGISTRY_EVENT_NAME = "__pubsub_mfe_devtools__";

function createBusMock(instanceId: string): PubSubBus {
  return {
    subscribe: () => () => {},
    publish: (topic, payload) => ({
      id: `${instanceId}-msg`,
      topic,
      ts: Date.now(),
      payload,
    }),
    registerSchema: () => {},
    getHistory: async () => [],
    handlerCount: () => 0,
    getStats: () => ({
      instanceId,
      app: "test",
      handlerCount: 0,
      subscriptionPatterns: [],
      retentionBufferSize: 0,
      retentionBufferCapacity: 0,
      messageCount: { published: 0, dispatched: 0 },
      disposed: false,
    }),
    getSubscriptions: () => [],
    clear: () => {},
    dispose: () => {},
    getHooks: () => ({
      onPublish: () => () => {},
      dispatchExternal: () => {},
    }),
  };
}

function createMetadata(instanceId: string, app = "test-app"): BusMetadata {
  return {
    instanceId,
    app,
    createdAt: Date.now(),
    config: {
      app,
      validationMode: "off",
      debug: false,
      enableDevTools: true,
    },
  };
}

describe("DevTools registry", () => {
  const cleanupBuses: PubSubBus[] = [];

  afterEach(() => {
    const registry = getDevToolsRegistry();

    if (!registry) {
      return;
    }

    for (const bus of cleanupBuses.splice(0)) {
      registry.unregister(bus);
    }

    vi.restoreAllMocks();
  });

  it("should expose a frozen singleton registry on window", () => {
    const registryA = getDevToolsRegistry();
    const registryB = getDevToolsRegistry();

    expect(registryA).toBeDefined();
    expect(registryA).toBe(registryB);
    expect(Object.isFrozen(registryA)).toBe(true);

    expect((window as Window & { __PUBSUB_MFE_DEVTOOLS_REGISTRY__?: unknown })
      .__PUBSUB_MFE_DEVTOOLS_REGISTRY__).toBe(registryA);
  });

  it("should register buses and return active metadata", () => {
    const registry = getDevToolsRegistry();
    expect(registry).toBeDefined();

    const bus1 = createBusMock("bus-1");
    const bus2 = createBusMock("bus-2");
    const metadata1 = createMetadata("bus-1", "app-1");
    const metadata2 = createMetadata("bus-2", "app-2");

    cleanupBuses.push(bus1, bus2);

    registry!.register(bus1, metadata1);
    registry!.register(bus2, metadata2);

    const all = registry!.getAll();
    const instances = all.map((m) => m.instanceId);

    expect(all).toHaveLength(2);
    expect(instances).toContain("bus-1");
    expect(instances).toContain("bus-2");
    expect(registry!.getBus("bus-1")).toBe(bus1);
    expect(registry!.getBus("bus-2")).toBe(bus2);
  });

  it("should unregister buses and emit BUS_DISPOSED event", () => {
    const registry = getDevToolsRegistry();
    expect(registry).toBeDefined();

    const bus = createBusMock("bus-dispose");
    const metadata = createMetadata("bus-dispose", "app-dispose");

    const listener = vi.fn();
    const unsubscribe = registry!.subscribe(listener);

    registry!.register(bus, metadata);
    registry!.unregister(bus);
    unsubscribe();

    expect(registry!.getBus("bus-dispose")).toBeUndefined();
    expect(registry!.getAll().some((m) => m.instanceId === "bus-dispose")).toBe(false);

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: "BUS_CREATED", metadata })
    );
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: "BUS_DISPOSED", metadata })
    );
  });

  it("should dispatch CustomEvent lifecycle notifications on window", () => {
    const registry = getDevToolsRegistry();
    expect(registry).toBeDefined();

    const bus = createBusMock("bus-events");
    const metadata = createMetadata("bus-events", "events-app");
    cleanupBuses.push(bus);

    const received: Array<{ type: string; metadata: BusMetadata }> = [];

    const handler = ((event: Event) => {
      const custom = event as CustomEvent<{ type: string; metadata: BusMetadata }>;
      received.push(custom.detail);
    }) as EventListener;

    window.addEventListener(REGISTRY_EVENT_NAME, handler);

    registry!.register(bus, metadata);
    registry!.unregister(bus);

    window.removeEventListener(REGISTRY_EVENT_NAME, handler);

    expect(received).toHaveLength(2);
    expect(received[0].type).toBe("BUS_CREATED");
    expect(received[0].metadata.instanceId).toBe("bus-events");
    expect(received[1].type).toBe("BUS_DISPOSED");
    expect(received[1].metadata.instanceId).toBe("bus-events");
  });

  it("should stop notifying after subscribe() unsubscribe is called", () => {
    const registry = getDevToolsRegistry();
    expect(registry).toBeDefined();

    const bus = createBusMock("bus-unsub");
    const metadata = createMetadata("bus-unsub", "unsubscribe-app");
    cleanupBuses.push(bus);

    const listener = vi.fn();
    const unsubscribe = registry!.subscribe(listener);

    unsubscribe();

    registry!.register(bus, metadata);

    expect(listener).not.toHaveBeenCalled();
  });
});
