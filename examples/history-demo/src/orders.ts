/**
 * Orders MFE - Late-joiner micro-frontend demonstrating history replay.
 *
 * Demonstrates:
 * - Late joiner receiving historical messages on tab open
 * - Real-time updates via Cross-Tab Adapter
 * - Publishing order events that persist to IndexedDB
 * - Wildcard topic subscriptions
 */
import { createPubSub } from '@pubsub/index';
import { createCrossTabAdapter, BroadcastChannelTransport } from '@pubsub/adapters/cross-tab/index';
import { createHistoryAdapter } from '@pubsub/adapters/history/index';
import type { Message } from '@pubsub/types';

interface OrderPayload {
  orderId: string;
  customer: string;
  product: string;
  amount: number;
  status: 'created' | 'updated' | 'shipped';
  timestamp: string;
}

let replayedCount = 0;
let liveCount = 0;
let orderCounter = 0;
const displayedOrders: Message<OrderPayload>[] = [];

const bus = createPubSub({
  debug: false,
  app: 'history-demo',
});
const transport = new BroadcastChannelTransport({ channelName: 'history-demo' });
const crossTabAdapter = createCrossTabAdapter({
  channelName: 'history-demo',
  transport,
  debug: false,
  dedupeWindowMs: 5000,
});

let historyAdapter: Awaited<ReturnType<typeof createHistoryAdapter>> | null = null;

async function initializeAdapters(): Promise<void> {
  try {
    crossTabAdapter.attach(bus);
    updateConnectionBadge('connected');
    
    // Create and attach history adapter (same namespace as dashboard)
    historyAdapter = await createHistoryAdapter({
      namespace: 'history-demo',
      maxMessages: 100,
      ttlSeconds: 300,
      gcIntervalMs: 30000,
      debug: false,
    });

    await historyAdapter.attach(bus);
    
    // Fetch and display historical orders (LATE-JOINER PATTERN)
    await replayHistory();
  } catch (error) {
    console.error('Failed to initialize:', error);
    updateConnectionBadge('disconnected');
  }
}

async function replayHistory(): Promise<void> {
  if (!historyAdapter) return;

  try {
    // Query for all order events from the last hour
    const fromTime = Date.now() - 60 * 60 * 1000; // Last hour
    const historicalOrders = await historyAdapter.getHistory<OrderPayload>('orders.#', {
      limit: 50,
      fromTime,
    });

    replayedCount = historicalOrders.length;
    updateStats();

    // Display historical orders (marked as replayed)
    for (const msg of historicalOrders) {
      displayOrder(msg, true);
    }

    console.log(`[Orders MFE] Replayed ${replayedCount} historical orders`);

  } catch (error) {
    console.error('Failed to replay history:', error);
  }
}

// Subscribe to all order events for real-time updates
bus.subscribe('orders.#', (message) => {
  // Skip if we already have this message (from history replay)
  if (displayedOrders.some((o) => o.id === message.id)) {
    return;
  }

  liveCount++;
  updateStats();
  displayOrder(message as Message<OrderPayload>, false);
});

// Also listen to inventory events to show cross-MFE communication
bus.subscribe('inventory.low-stock', (message) => {
  showNotification(`⚠️ Low Stock Alert: ${JSON.stringify(message.payload)}`);
});

// ============================================================================
// UI Event Handlers
// ============================================================================

// Create order form
const orderForm = document.getElementById('order-form') as HTMLFormElement;
orderForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const customerInput = document.getElementById('customer') as HTMLInputElement;
  const productInput = document.getElementById('product') as HTMLInputElement;
  const amountInput = document.getElementById('amount') as HTMLInputElement;

  orderCounter++;
  const orderId = `ORD-${Date.now().toString(36).toUpperCase()}-${orderCounter}`;

  const orderPayload: OrderPayload = {
    orderId,
    customer: customerInput.value.trim() || 'Anonymous',
    product: productInput.value.trim() || 'Unknown Product',
    amount: parseFloat(amountInput.value) || 0,
    status: 'created',
    timestamp: new Date().toISOString(),
  };

  // Publish order.created event (persists to IndexedDB via history adapter)
  bus.publish('orders.created', orderPayload, { source: 'orders-mfe' });
});

// Re-fetch history button
document.getElementById('replay-history')?.addEventListener('click', async () => {
  // Clear current display
  displayedOrders.length = 0;
  replayedCount = 0;
  liveCount = 0;
  clearOrdersList();

  // Replay from history
  await replayHistory();
});

// Ship random order button
document.getElementById('ship-random')?.addEventListener('click', () => {
  if (displayedOrders.length === 0) {
    showNotification('No orders to ship!');
    return;
  }

  // Pick a random order
  const randomIndex = Math.floor(Math.random() * displayedOrders.length);
  const order = displayedOrders[randomIndex].payload as OrderPayload;

  const shippedPayload: OrderPayload = {
    ...order,
    status: 'shipped',
    timestamp: new Date().toISOString(),
  };

  bus.publish('orders.shipped', shippedPayload, { source: 'orders-mfe' });
});

// Clear feed button
document.getElementById('clear-feed')?.addEventListener('click', () => {
  displayedOrders.length = 0;
  replayedCount = 0;
  liveCount = 0;
  clearOrdersList();
  updateStats();
});

function updateConnectionBadge(status: 'connected' | 'disconnected' | 'pending'): void {
  const badge = document.querySelector('#connection-badge .badge');
  if (!badge) return;

  badge.className = `badge badge-${status}`;
  badge.textContent = status === 'connected' ? 'Connected' : status === 'pending' ? 'Connecting...' : 'Disconnected';
}

function updateStats(): void {
  const replayedEl = document.getElementById('replayed-count');
  const liveEl = document.getElementById('live-count');
  const feedCountEl = document.getElementById('feed-count');

  if (replayedEl) replayedEl.textContent = String(replayedCount);
  if (liveEl) liveEl.textContent = String(liveCount);
  if (feedCountEl) feedCountEl.textContent = `${displayedOrders.length} orders`;
}

function displayOrder(message: Message<OrderPayload>, isReplayed: boolean): void {
  const container = document.getElementById('orders-list');
  if (!container) return;

  // Remove empty state if present
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }

  displayedOrders.push(message);

  const order = message.payload;
  const time = new Date(message.ts).toLocaleString();
  const replayBadge = isReplayed ? '<span class="badge badge-replayed">From History</span>' : '<span class="badge badge-live">Live</span>';

  const statusClass = `status-${order.status}`;

  const orderElement = document.createElement('div');
  orderElement.className = `order-card ${isReplayed ? 'replayed' : 'live'}`;
  orderElement.dataset.orderId = order.orderId;
  orderElement.innerHTML = `
    <div class="order-header">
      <span class="order-id">${order.orderId}</span>
      ${replayBadge}
    </div>
    <div class="order-details">
      <div class="order-field">
        <span class="field-label">Customer:</span>
        <span class="field-value">${order.customer}</span>
      </div>
      <div class="order-field">
        <span class="field-label">Product:</span>
        <span class="field-value">${order.product}</span>
      </div>
      <div class="order-field">
        <span class="field-label">Amount:</span>
        <span class="field-value">$${order.amount.toFixed(2)}</span>
      </div>
      <div class="order-field">
        <span class="field-label">Status:</span>
        <span class="field-value ${statusClass}">${order.status.toUpperCase()}</span>
      </div>
    </div>
    <div class="order-footer">
      <span class="order-time">${time}</span>
      <span class="order-topic">${message.topic}</span>
    </div>
  `;

  // Prepend to show newest first
  container.insertBefore(orderElement, container.firstChild);

  // Limit displayed orders
  const maxOrders = 50;
  while (container.children.length > maxOrders) {
    container.removeChild(container.lastChild!);
  }

  updateStats();
}

function clearOrdersList(): void {
  const container = document.getElementById('orders-list');
  if (!container) return;

  container.innerHTML = `
    <div class="empty-state">
      <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="7" y1="7" x2="7.01" y2="7" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <p>No orders yet. History will load automatically.</p>
    </div>
  `;
}

function showNotification(message: string): void {
  // Simple notification
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

console.log('[Orders MFE] Initializing...');

initializeAdapters().then(() => {
  console.log('[Orders MFE] Ready!');
});

// Cleanup on page unload
window.addEventListener('beforeunload', async () => {
  if (historyAdapter) {
    await historyAdapter.detach();
  }
  await crossTabAdapter.detach();
});
