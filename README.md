<div align="center">
  <img src="./assets/logo.svg" alt="pubsub-mfe logo" width="128" height="128">
</div>

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

📚 **[View Full Documentation](https://belyas.github.io/pubsub-mfe-docs/)**

## Documentation

Comprehensive guides and examples are available in the online documentation:

- **[Getting Started](https://belyas.github.io/pubsub-mfe-docs/guide/getting-started.html)** — Installation and basic usage
- **[Core Concepts](https://belyas.github.io/pubsub-mfe-docs/guide/core-concepts.html)** — Understanding the pub/sub pattern
- **[Topic Patterns](https://belyas.github.io/pubsub-mfe-docs/guide/topic-patterns.html)** — MQTT-style wildcards (`+`, `#`)
- **[Schema Validation](https://belyas.github.io/pubsub-mfe-docs/guide/schema-validation.html)** — JSON Schema validation
- **[Source Filtering](https://belyas.github.io/pubsub-mfe-docs/guide/source-filtering.html)** — Message filtering by source
- **[Handler Isolation](https://belyas.github.io/pubsub-mfe-docs/guide/handler-isolation.html)** — Bulkhead pattern for fault tolerance
- **[Adapters](https://belyas.github.io/pubsub-mfe-docs/guide/adapters/cross-tab.html)** — Cross-tab, iframe, and history adapters
- **[API Reference](https://belyas.github.io/pubsub-mfe-docs/api/core.html)** — Complete API documentation
- **[Examples](https://belyas.github.io/pubsub-mfe-docs/examples/basic.html)** — Practical patterns and recipes

## Key Features

### 🎯 Zero Dependencies
Built entirely on native browser APIs with tree-shaking support for minimal bundle size.

### 🔒 Security First
- **Prototype pollution prevention** — Blocks dangerous property names
- **ReDoS protection** — Validates regex patterns for catastrophic backtracking
- **Input length limits** — Prevents DoS via long strings
- **Origin validation** — iframe adapter validates all messages

### 🎭 MQTT-Style Wildcards
Flexible topic patterns with `+` (single-level) and `#` (multi-level) wildcards. **[Topic Patterns](https://belyas.github.io/pubsub-mfe-docs/guide/topic-patterns.html)**.

### 🛡️ Handler Isolation
Bulkhead pattern ensures one failing handler doesn't affect others. **[Handler Isolation](https://belyas.github.io/pubsub-mfe-docs/guide/handler-isolation.html)**.

### 📋 Schema Validation
Optional JSON Schema validation with strict/warn modes. **[Schema Validation](https://belyas.github.io/pubsub-mfe-docs/guide/schema-validation.html)**.

### 🔄 Message Replay
In-memory retention buffer for late-joining subscribers with configurable TTL. For advanced usage, you can use history adapter which implements IndexedDB under the hood. **[History Adapter](https://belyas.github.io/pubsub-mfe-docs/guide/adapters/history.html)**.

### 🖼️ Iframe Adapter
Secure bidirectional communication with sandboxed iframes using MessageChannel. **[Iframe Adapter](https://belyas.github.io/pubsub-mfe-docs/guide/adapters/iframe.html)**.

### 🔗 AbortSignal Support
Lifecycle-aware subscriptions that integrate with component cleanup.

### 📊 Diagnostics
Built-in hooks for monitoring, debugging, and observability.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

[Apache-2.0](./LICENSE) © Yassine Belkaid

---

**[📚 Full Documentation](https://belyas.github.io/pubsub-mfe-docs/)** • **[💬 Discussions](https://github.com/belyas/pubsub-mfe/discussions)** • **[🐛 Issues](https://github.com/belyas/pubsub-mfe/issues)**
