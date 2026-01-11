# @belyas/pubsub-mfe

> Browser-native Pub/Sub for microfrontends — zero dependencies, MQTT-style wildcards, optional schema validation.

A production-grade publish/subscribe bus designed for microfrontend architectures. Uses only native browser APIs, provides handler isolation, and supports flexible topic patterns.

## Features

- **Zero Dependencies** — No external libraries, tree-shakable
- **MQTT-style Wildcards** — `+` (single-level) and `#` (multi-level) patterns
- **Handler Isolation** — Bulkhead pattern prevents cascading failures
- **AbortSignal Support** — Lifecycle-aware subscriptions
- **Schema Validation** — Optional JSON Schema validation with strict/warn modes
- **Source Filtering** — Include/exclude messages by source identifier
- **Diagnostics Hooks** — Observability for debugging and monitoring
- **TypeScript-First** — Full type safety with branded types

## Installation

```bash
npm install @belyas/pubsub-mfe
```

## Build & Development

If you want to build or run the project locally (examples, tests, or to contribute), use the package scripts provided in the repository. The project uses pnpm as the package manager.

### Install dependencies:

```bash
pnpm install
```

### Common development tasks:

```bash
# Build the library (outputs to dist/)
pnpm run build

# Run the test suite (Vitest)
pnpm run test

# Run type checking (TS compiler)
pnpm run typecheck

# Lint the source (ESLint)
pnpm run lint

# Check/format code (Prettier)
pnpm run format:check
pnpm run format

# Run the demo example (TypeScript)
# Option A: run the compiled example (requires a prior build)
node examples/demo.mjs
# Option B: run the TypeScript example directly
node examples/demo.ts
```

## Quick Start

```typescript
import { createPubSub } from '@belyas/pubsub-mfe';

// Create a bus instance
const bus = createPubSub({ app: 'my-app' });

// Subscribe to a topic
bus.subscribe('cart.item.add', (msg) => {
  console.log('Item added:', msg.payload);
});

// Publish a message
bus.publish('cart.item.add', { sku: 'ABC123', qty: 1 });
```

## Topic Patterns

Topics use dot notation with MQTT-style wildcards:

| Pattern         | Matches                           | Does Not Match                |
|-----------------|-----------------------------------|-------------------------------|
| `cart.item.add` | `cart.item.add`                   | `cart.item.remove`            |
| `cart.+.update` | `cart.item.update`, `cart.promo.update` | `cart.item.detail.update` |
| `cart.#`        | `cart.item`, `cart.item.add`, etc | `user.login`                  |
| `#`             | Everything                        | —                             |

```typescript
// Single-level wildcard: matches one segment
bus.subscribe('cart.+.update', (msg) => {
  console.log('Update on:', msg.topic);
});

// Multi-level wildcard: matches remaining segments
bus.subscribe('cart.#', (msg) => {
  console.log('Cart event:', msg.topic, msg.payload);
});
```

## AbortSignal Support

Manage subscription lifecycle with `AbortController`:

```typescript
const controller = new AbortController();

bus.subscribe('events', handler, { signal: controller.signal });

// Later: automatically unsubscribes
controller.abort();
```

This integrates naturally with component lifecycles:

```typescript
// React example with cleanup
useEffect(() => {
  const controller = new AbortController();
  
  bus.subscribe('user.#', handleUserEvent, { 
    signal: controller.signal 
  });
  
  return () => controller.abort();
}, []);
```

## Schema Validation

Register JSON schemas for payload validation:

```typescript
const bus = createPubSub({ 
  validationMode: 'strict'  // 'strict' | 'warn' | 'off'
});

// Register a schema
bus.registerSchema('cart.item@1', {
  type: 'object',
  properties: {
    sku: { type: 'string' },
    qty: { type: 'number', minimum: 1 },
  },
  required: ['sku', 'qty'],
  additionalProperties: false,
});

// Publish with validation
bus.publish('cart.item.add', { sku: 'ABC', qty: 2 }, {
  schemaVersion: 'cart.item@1'
});

// In strict mode, this throws:
bus.publish('cart.item.add', { sku: 'ABC', qty: 0 }, {
  schemaVersion: 'cart.item@1'
});
// Error: Validation failed for schema "cart.item@1": qty: Number must be at least 1
```

## Source Filtering

Filter messages by source to avoid echo or isolate traffic:

```typescript
// Ignore messages from self
bus.subscribe('events', handler, {
  sourceFilter: { exclude: ['my-component'] }
});

// Only accept from trusted sources
bus.subscribe('commands', handler, {
  sourceFilter: { include: ['host-app', 'admin-panel'] }
});

// Publish with source identifier
bus.publish('events', data, { source: 'my-component' });
```

## Diagnostics

Monitor bus activity for debugging and observability:

```typescript
const bus = createPubSub({
  debug: true,  // Console logging
  onDiagnostic: (event) => {
    switch (event.type) {
      case 'publish':
        console.log(`Published to ${event.topic}, ${event.handlerCount} handlers`);
        break;
      case 'handler-error':
        console.error('Handler failed:', event.error);
        break;
      case 'validation-error':
        console.warn('Validation failed:', event.errors);
        break;
    }
  }
});
```

## Handler Isolation (Bulkhead Pattern)

Handlers are isolated — one failing handler doesn't affect others:

```typescript
bus.subscribe('events', () => {
  throw new Error('Handler 1 crashed!');
});

bus.subscribe('events', (msg) => {
  // This still receives the message
  console.log('Handler 2 received:', msg);
});

bus.publish('events', { data: 'test' });
// Handler 2 runs successfully; error is logged to diagnostics
```

## In-Memory Retention & Replay

Enable message retention for late-joining subscribers:

```typescript
const bus = createPubSub({
  retention: {
    maxMessages: 100,    // Keep last 100 messages globally
    perTopic: {
      'orders.#': 50,    // Keep last 50 order events
      'metrics.#': 20,   // Keep fewer metrics
    },
    ttlMs: 5 * 60 * 1000, // Expire messages older than 5 minutes
  },
});

// Publish some events
bus.publish('orders.created', { orderId: 'ORD-001' });
bus.publish('orders.created', { orderId: 'ORD-002' });
bus.publish('orders.shipped', { orderId: 'ORD-001' });

// Later: new subscriber requests replay of last 10 messages
bus.subscribe('orders.#', (msg) => {
  console.log('Order event:', msg.topic, msg.payload);
}, { replay: 10 });
// Receives: orders.created (ORD-001), orders.created (ORD-002), orders.shipped (ORD-001)
```

**Key behaviors:**
- Messages are replayed synchronously before live delivery begins
- Only messages matching the subscription pattern are replayed
- Oldest messages are evicted when buffer is full (ring/circular buffer)
- TTL filtering happens at replay time (expired messages are skipped)
- Per-topic limits override the global `maxMessages` for matching topics

## Security

This library includes multiple layers of security protection:

### Prototype Pollution Prevention

All object property checks use `Object.hasOwn()` instead of the `in` operator, and dangerous property names are blocked:

```typescript
// These properties are blocked in schemas and payloads:
// __proto__, constructor, prototype

// Attempting to validate a payload with dangerous properties will fail:
const result = validatePayload({ __proto__: {} }, schema);
// result.valid === false, error: "Property '__proto__' is not allowed (security restriction)"

// Schemas defining dangerous properties are rejected at registration:
registerSchema('evil@1', {
  properties: { __proto__: { type: 'object' } }
});
// Throws: "Schema defines dangerous property '__proto__'"
```

### ReDoS (Regular Expression Denial of Service) Prevention

Schema regex patterns are validated for potentially catastrophic backtracking:

```typescript
// Evil regex patterns are blocked:
registerSchema('evil@1', {
  type: 'string',
  pattern: '(a+)+',  // Nested quantifiers - BLOCKED
});
// Throws: "contains nested quantifiers which can cause catastrophic backtracking"

// Blocked patterns include:
// - Nested quantifiers: (a+)+, (.*)+, (\s+)+
// - Overlapping alternations: (a|aa)+, (a|a?)+
// - Character class with quantifier in group: ([a-z]+)+
// - Patterns exceeding 256 characters

// Safe patterns work normally:
registerSchema('email@1', {
  type: 'string',
  pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
});
```

### Input Length Limits

Strings are limited to 10,000 characters for regex pattern matching to prevent DoS via long inputs.

```typescript
import { isUnsafeRegexPattern } from '@belyas/pubsub-intra-page';

// Check if a pattern is safe before using it:
const check = isUnsafeRegexPattern('(a+)+');
// check.unsafe === true, check.reason === "contains nested quantifiers..."
```

## Configuration

```typescript
interface PubSubConfig {
  /** Application identifier for namespacing */
  app?: string;
  
  /** Validation mode: 'strict' | 'warn' | 'off' */
  validationMode?: ValidationMode;
  
  /** Maximum handlers per topic pattern (default: 100) */
  maxHandlersPerTopic?: number;
  
  /** Enable debug logging */
  debug?: boolean;
  
  /** Diagnostics callback */
  onDiagnostic?: DiagnosticHandler;

  /** In-memory message retention for replay */
  retention?: {
    maxMessages: number;           // Max messages to retain globally
    perTopic?: Record<string, number>; // Per-topic limits
    ttlMs?: number;                // Time-to-live in ms
  };
}
  onDiagnostic?: DiagnosticHandler;
}
```

## API Reference

### `createPubSub(config?): PubSubBus`

Create a new bus instance.

### `bus.subscribe(pattern, handler, options?): Unsubscribe`

Subscribe to a topic pattern. Returns an unsubscribe function.

**Options:**
- `signal?: AbortSignal` — Auto-unsubscribe when aborted
- `sourceFilter?: { include?: string[], exclude?: string[] }` — Filter by source
- `replay?: number` — Replay last N messages from retention buffer (requires `retention` config)

### `bus.publish(topic, payload, options?): Message`

Publish a message. Returns the message envelope.

**Options:**
- `source?: string` — Source identifier
- `schemaVersion?: string` — Schema to validate against
- `correlationId?: string` — For request-response tracing
- `meta?: object` — Additional metadata

### `bus.registerSchema(version, schema): void`

Register a JSON schema for validation.

### `bus.handlerCount(pattern?): number`

Get handler count (total or per pattern).

### `bus.clear(): void`

Remove all subscriptions.

### `bus.dispose(): void`

Dispose the bus. No further operations allowed.

## Message Envelope

Every message includes:

```typescript
interface Message<T> {
  id: MessageId;        // Unique UUID
  topic: Topic;         // Exact topic
  ts: Timestamp;        // Unix timestamp (ms)
  payload: T;           // Your data
  schemaVersion?: string;
  meta?: {
    source?: string;
    correlationId?: string;
    [key: string]: unknown;
  };
}
```

## Design Principles

This implementation follows the architecture from the thesis "Design and Implementation of a Secure, Efficient Pub/Sub Protocol for Microfrontend Architectures":

1. **Native APIs Only** — No external dependencies
2. **Handler Isolation** — Bulkhead pattern for fault tolerance
3. **Async Dispatch** — Uses `queueMicrotask` for consistent timing
4. **Topic Validation** — Prevents wildcards in publish topics
5. **Bounded Resources** — Configurable handler limits

## License

[Apache-2.0](./LICENSE) © Yassine Belkaid.
