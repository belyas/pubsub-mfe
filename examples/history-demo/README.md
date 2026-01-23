# History Demo - IndexedDB Ledger with Cross-Tab Micro-frontends

This demo showcases the **History Adapter** feature of `@belyas/pubsub-mfe`, demonstrating:

- 📦 **IndexedDB Persistence** - Messages are persisted across browser sessions
- 🔄 **Cross-Tab Synchronization** - Real-time message sync between browser tabs
- ⏰ **Late-Joiner Support** - New tabs can retrieve historical messages
- 🧹 **Garbage Collection** - Automatic cleanup with TTL and max message limits
- 🔍 **Wildcard Queries** - Query history with MQTT-style topic patterns

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         IndexedDB                                │
│                    (pubsub-history database)                     │
│              ┌──────────────────────────────────┐               │
│              │     Persisted Messages           │               │
│              │  namespace: "history-demo"       │               │
│              └──────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
         ▲                    ▲                    ▲
         │ write              │ read               │ write
         │                    │                    │
┌────────┴───────┐  ┌────────┴───────┐  ┌────────┴───────┐
│   Dashboard    │  │   Orders MFE   │  │  Inventory MFE │
│   (Tab 1)      │  │   (Tab 2)      │  │   (Tab 3)      │
├────────────────┤  ├────────────────┤  ├────────────────┤
│ HistoryAdapter │  │ HistoryAdapter │  │ HistoryAdapter │
│ CrossTabAdapter│  │ CrossTabAdapter│  │ CrossTabAdapter│
│    PubSub      │  │    PubSub      │  │    PubSub      │
└────────────────┘  └────────────────┘  └────────────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                    BroadcastChannel
                   (Real-time sync)
```

## Quick Start

```bash
# Navigate to the demo directory
cd examples/history-demo

# Install dependencies
pnpm install

# Start the development server
pnpm dev
```

Open http://localhost:3001 in your browser.

## Demo Workflow

### 1. Dashboard (Main Tab)
- Open the dashboard at `http://localhost:3001`
- View adapter status and storage statistics
- Publish events using the form
- Query message history with wildcard patterns
- Force garbage collection or clear history

### 2. Orders MFE (Late-Joiner Tab)
- Click "Open Orders Tab" or navigate to `/orders.html`
- **Watch it automatically load historical order messages**
- Create new orders that persist to IndexedDB
- See real-time updates from other tabs

### 3. Inventory MFE (Another Late-Joiner)
- Click "Open Inventory Tab" or navigate to `/inventory.html`
- **Also loads historical inventory events on open**
- Update inventory levels
- Trigger low-stock alerts that all tabs receive

## Key Features Demonstrated

### Late-Joiner Pattern
```typescript
// When a new tab opens, it fetches historical messages
const historyAdapter = await createHistoryAdapter({
  namespace: 'history-demo',
  maxMessages: 100,
  ttlSeconds: 300,
});

await historyAdapter.attach(bus);

// Query for historical messages
const history = await historyAdapter.getHistory('orders.#', {
  limit: 50,
  fromTime: Date.now() - 3600000, // Last hour
});

// Display historical messages
for (const msg of history) {
  displayMessage(msg, { fromHistory: true });
}
```

### Cross-Tab Real-Time Sync
```typescript
// All tabs share the same channel and namespace
const transport = new BroadcastChannelTransport({ 
  channelName: 'history-demo' 
});

const crossTabAdapter = createCrossTabAdapter({
  channelName: 'history-demo',
  transport,
});

await crossTabAdapter.attach(bus);

// Messages published in any tab appear in all tabs
bus.publish('orders.created', orderPayload);
```

### Wildcard Topic Queries
```typescript
// Query with wildcards
await historyAdapter.getHistory('orders.#');      // All orders
await historyAdapter.getHistory('inventory.+');   // inventory.updated, inventory.low-stock
await historyAdapter.getHistory('#');             // Everything
```

### Garbage Collection
```typescript
// Automatic GC based on config
const historyAdapter = await createHistoryAdapter({
  maxMessages: 100,    // Keep max 100 messages
  ttlSeconds: 300,     // Delete messages older than 5 minutes
  gcIntervalMs: 30000, // Run GC every 30 seconds
});

// Manual GC trigger
await historyAdapter.forceGc();

// Get statistics
const stats = await historyAdapter.getStats();
console.log(stats.messagesGarbageCollected);
```

## Testing Scenarios

### Scenario 1: Basic Persistence
1. Open Dashboard, publish a few events
2. Close all tabs
3. Reopen Dashboard → Events still in history

### Scenario 2: Late Joiner
1. Open Dashboard, publish 10 order events
2. Open Orders tab → Should show all 10 orders immediately
3. Publish more events → Orders tab shows them in real-time

### Scenario 3: Cross-Tab Sync
1. Open Dashboard and Orders tab side-by-side
2. Create order in Orders tab
3. Dashboard event log shows the event instantly

### Scenario 4: Garbage Collection
1. Open Dashboard
2. Publish 120+ messages (exceeds maxMessages: 100)
3. Watch GC remove oldest messages
4. Use "Force GC" to trigger manual cleanup

### Scenario 5: Multiple MFEs
1. Open all three tabs: Dashboard, Orders, Inventory
2. Trigger low-stock alert from Inventory
3. Dashboard and Orders both receive the alert

## Project Structure

```
history-demo/
├── index.html          # Dashboard (main control panel)
├── orders.html         # Orders micro-frontend
├── inventory.html      # Inventory micro-frontend
├── package.json        # Dependencies
├── tsconfig.json       # TypeScript config
├── vite.config.ts      # Vite bundler config
└── src/
    ├── dashboard.ts    # Dashboard logic
    ├── orders.ts       # Orders MFE logic
    ├── inventory.ts    # Inventory MFE logic
    └── styles/
        └── main.css    # Shared styles
```

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `namespace` | `'default'` | Isolates storage for different apps |
| `maxMessages` | `1000` | Max messages before GC removes oldest |
| `ttlSeconds` | `3600` | Messages older than this are GC candidates |
| `gcIntervalMs` | `60000` | How often full GC runs |
| `debug` | `false` | Enable console logging |

## Browser Support

- Chrome 54+
- Firefox 38+
- Safari 10.1+
- Edge 79+

Requires IndexedDB and BroadcastChannel support.

## Related Documentation

- [History Adapter API](../../src/adapters/history/README.md)
- [Cross-Tab Adapter API](../../src/adapters/cross-tab/README.md)
- [Main Package README](../../README.md)
