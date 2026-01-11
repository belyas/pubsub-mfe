import { createPubSub } from '../dist/index.js';

console.log('🚀 PubSub Demo\n');
console.log('═'.repeat(60));

// Create bus with diagnostics
const bus = createPubSub({
  app: 'shop-demo',
  debug: false,
  validationMode: 'strict',
  onDiagnostic: (event) => {
    if (event.type === 'publish') {
      console.log(`[diagnostics] 📤 Published to "${event.topic}" → ${event.handlerCount} handler(s)`);
    } else if (event.type === 'handler-error') {
      console.log(`[diagnostics] ❌ Handler error: ${event.error.message}`);
    }
  },
});

console.log('\n📋 Registering schemas...');

bus.registerSchema('cart.item@1', {
  type: 'object',
  properties: {
    sku: { type: 'string', minLength: 1 },
    name: { type: 'string' },
    qty: { type: 'number', minimum: 1 },
    price: { type: 'number', minimum: 0 },
  },
  required: ['sku', 'qty'],
  additionalProperties: false,
});

bus.registerSchema('user.auth@1', {
  type: 'object',
  properties: {
    userId: { type: 'string' },
    email: { type: 'string' },
    roles: { type: 'array', items: { type: 'string' } },
  },
  required: ['userId'],
});

console.log('  ✓ cart.item@1');
console.log('  ✓ user.auth@1');

console.log('\n🎯 Registering subscriptions...');

// Cart MFE: listens to all cart events
const cartController = new AbortController();
bus.subscribe('cart.#', (msg) => {
  console.log(`  [Cart MFE] Received ${msg.topic}:`, JSON.stringify(msg.payload));
}, { signal: cartController.signal });
console.log('  ✓ Cart MFE subscribed to "cart.#"');

// Analytics MFE: listens to specific events
bus.subscribe<{ sku: string }>('cart.item.add', (msg) => {
  console.log(`  [Analytics] Item added: ${msg.payload.sku}`);
});
bus.subscribe<{ userId: string }>('user.login', (msg) => {
  console.log(`  [Analytics] User logged in: ${msg.payload.userId}`);
});
console.log('  ✓ Analytics MFE subscribed to cart.item.add, user.login');

// Header MFE: catch-all for UI updates
bus.subscribe('user.#', (msg) => {
  console.log(`  [Header MFE] User event: ${msg.topic}`);
}, { sourceFilter: { exclude: ['header-mfe'] } }); // Ignore own messages

console.log('  ✓ Header MFE subscribed to "user.#" (excluding self)');
console.log('═'.repeat(60));
console.log('📨 Publishing events...\n');

// Wait for microtask queue to flush between publishes for cleaner output
async function demo() {
  // 1. User login
  bus.publish('user.login', { userId: 'u123', email: 'alice@example.com' }, {
    schemaVersion: 'user.auth@1',
    source: 'auth-service',
  });
  await flush();

  // 2. Add item to cart
  bus.publish('cart.item.add', { sku: 'WIDGET-01', name: 'Super Widget', qty: 2, price: 29.99 }, {
    schemaVersion: 'cart.item@1',
    source: 'product-page',
  });
  await flush();

  // 3. Update cart quantity
  bus.publish('cart.item.update', { sku: 'WIDGET-01', qty: 5 }, {
    schemaVersion: 'cart.item@1',
    source: 'cart-drawer',
  });
  await flush();

  // 4. Cart checkout
  bus.publish('cart.checkout.start', { items: 1, total: 149.95 }, {
    source: 'checkout-mfe',
  });
  await flush();

  // 5. User logout (from header)
  bus.publish('user.logout', { userId: 'u123' }, {
    source: 'header-mfe', // Header ignores its own events
  });
  await flush();

  console.log('═'.repeat(60));
  console.log('🔌 Aborting Cart MFE subscription...\n');

  cartController.abort();

  // This won't be received by Cart MFE
  bus.publish('cart.item.remove', { sku: 'WIDGET-01' });
  await flush();

  console.log('  → Cart MFE no longer receives events\n');
  console.log('═'.repeat(60));
  console.log('🛡️ Testing handler isolation (Bulkhead pattern)...\n');

  // Add a failing handler
  bus.subscribe('test.isolation', () => {
    throw new Error('Intentional failure!');
  });

  // Add a working handler
  bus.subscribe('test.isolation', (msg) => {
    console.log('  [Working Handler] Received:', msg.payload);
  });

  bus.publish('test.isolation', { test: 'data' });
  await flush();

  console.log('\n  → Working handler still executed despite failing handler\n');
  console.log('═'.repeat(60));
  console.log('✅ Testing schema validation...\n');

  try {
    bus.publish('cart.item.add', { sku: 'INVALID', qty: 0 }, { // qty must be >= 1
      schemaVersion: 'cart.item@1',
    });
  } catch (err) {
    console.log('  ❌ Validation error (expected):', (err as Error).message);
  }

  console.log('═'.repeat(60));
  console.log('🔄 Testing in-memory retention & replay...\n');

  // Create a new bus with retention enabled
  const retentionBus = createPubSub({
    app: 'retention-demo',
    retention: {
      maxMessages: 100, // Keep last 100 messages globally
      perTopic: {
        'orders.#': 10, // Keep last 10 order messages
      },
    },
  });

  // Publish some events BEFORE any subscribers
  console.log('  📤 Publishing events before any subscribers...');
  retentionBus.publish('orders.created', { orderId: 'ORD-001', total: 99.99 });
  retentionBus.publish('orders.created', { orderId: 'ORD-002', total: 149.99 });
  retentionBus.publish('orders.shipped', { orderId: 'ORD-001', carrier: 'FedEx' });
  retentionBus.publish('inventory.updated', { sku: 'WIDGET-01', qty: 42 });
  retentionBus.publish('inventory.updated', { sku: 'WIDGET-02', qty: 15 });
  await flush();

  console.log('  ✓ 5 events published (2 orders.created, 1 orders.shipped, 2 inventory.updated)\n');

  // Late-joining subscriber wants the last 3 messages
  console.log('  📥 Late subscriber joins, requests replay of last 3 messages:');
  retentionBus.subscribe('orders.#', (msg) => {
    console.log(`    [Orders MFE] Replayed: ${msg.topic} → orderId: ${(msg.payload as { orderId: string }).orderId}`);
  }, { replay: 3 });
  await flush();

  // Another subscriber wants all inventory messages from the buffer
  console.log('\n  📥 Another late subscriber wants all inventory messages:');
  retentionBus.subscribe('inventory.+', (msg) => {
    console.log(`    [Inventory MFE] Replayed: ${msg.topic} → sku: ${(msg.payload as { sku: string }).sku}`);
  }, { replay: 100 }); // Request more than available
  await flush();

  console.log('\n  → Late subscribers received historical messages from retention buffer\n');

  retentionBus.dispose();

  console.log('═'.repeat(60));
  console.log('📊 Summary');
  console.log(`  Total handlers registered: ${bus.handlerCount()}`);
  console.log('\n✨ Demo complete!');

  bus.dispose();
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

demo().catch(console.error);
