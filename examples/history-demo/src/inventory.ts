/**
 * Inventory MFE - Another late-joiner micro-frontend demonstrating cross-tab sync.
 *
 * Demonstrates:
 * - Different MFE with same history adapter namespace
 * - Cross-MFE event consumption (listens to orders too)
 * - Publishing inventory-specific events
 * - History queries with different topic patterns
 */
import { createPubSub } from '@pubsub/index';
import { createCrossTabAdapter, BroadcastChannelTransport } from '@pubsub/adapters/cross-tab/index';
import { createHistoryAdapter } from '@pubsub/adapters/history/index';
import type { Message } from '@pubsub/types';

interface InventoryPayload {
  sku: string;
  quantity: number;
  action: 'add' | 'remove' | 'set';
  previousQuantity?: number;
  timestamp: string;
}

interface LowStockPayload {
  sku: string;
  currentQuantity: number;
  threshold: number;
  timestamp: string;
}

let historyCount = 0;
let realtimeCount = 0;
const displayedEvents: Message[] = [];
const inventoryLevels: Map<string, number> = new Map();

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

    // Create and attach history adapter (same namespace as other MFEs)
    historyAdapter = await createHistoryAdapter({
      namespace: 'history-demo',
      maxMessages: 100,
      ttlSeconds: 300,
      gcIntervalMs: 30000,
      debug: false,
    });

    await historyAdapter.attach(bus);

    // Fetch and display historical inventory events
    await loadHistory();
  } catch (error) {
    console.error('Failed to initialize:', error);
    updateConnectionBadge('disconnected');
  }
}

async function loadHistory(): Promise<void> {
  if (!historyAdapter) return;

  try {
    const fromTime = Date.now() - 60 * 60 * 1000; // Last hour
    // Query for inventory events
    const inventoryEvents = await historyAdapter.getHistory<InventoryPayload>('inventory.#', {
      limit: 30,
      fromTime,
    });

    historyCount = inventoryEvents.length;
    updateStats();

    // Display historical events
    for (const msg of inventoryEvents) {
      displayEvent(msg, true);
    }

    console.log(`[Inventory MFE] Loaded ${historyCount} historical inventory events`);
  } catch (error) {
    console.error('Failed to load history:', error);
  }
}

// Subscribe to inventory events
bus.subscribe('inventory.#', (message) => {
  // Skip if already displayed
  if (displayedEvents.some((e) => e.id === message.id)) {
    return;
  }

  realtimeCount++;
  updateStats();
  displayEvent(message, false);

  // Update inventory levels
  if (message.topic === 'inventory.updated') {
    const payload = message.payload as InventoryPayload;
    const currentLevel = inventoryLevels.get(payload.sku) || 0;

    switch (payload.action) {
      case 'add':
        inventoryLevels.set(payload.sku, currentLevel + payload.quantity);
        break;
      case 'remove':
        inventoryLevels.set(payload.sku, Math.max(0, currentLevel - payload.quantity));
        break;
      case 'set':
        inventoryLevels.set(payload.sku, payload.quantity);
        break;
    }
  }
});

// Also listen to order events to show cross-MFE awareness
bus.subscribe('orders.created', (message) => {
  console.log('[Inventory MFE] New order detected:', message.payload);
  showNotification(`📦 New order received - check inventory levels!`);
});

// Inventory update form
const inventoryForm = document.getElementById('inventory-form') as HTMLFormElement;
inventoryForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const skuInput = document.getElementById('sku') as HTMLInputElement;
  const quantityInput = document.getElementById('quantity') as HTMLInputElement;
  const actionSelect = document.getElementById('action') as HTMLSelectElement;
  const sku = skuInput.value.trim() || 'UNKNOWN';
  const quantity = parseInt(quantityInput.value, 10) || 0;
  const action = actionSelect.value as 'add' | 'remove' | 'set';
  const currentLevel = inventoryLevels.get(sku) || 0;
  const inventoryPayload: InventoryPayload = {
    sku,
    quantity,
    action,
    previousQuantity: currentLevel,
    timestamp: new Date().toISOString(),
  };

  // Publish inventory update (persists to IndexedDB)
  bus.publish('inventory.updated', inventoryPayload, { source: 'inventory-mfe' });
});

// Low stock alert button
document.getElementById('low-stock-alert')?.addEventListener('click', () => {
  const lowStockPayload: LowStockPayload = {
    sku: 'WIDGET-001',
    currentQuantity: 5,
    threshold: 10,
    timestamp: new Date().toISOString(),
  };

  bus.publish('inventory.low-stock', lowStockPayload, { source: 'inventory-mfe' });
  showNotification('⚠️ Low stock alert published!');
});

// Reload history button
document.getElementById('reload-history')?.addEventListener('click', async () => {
  // Clear display
  displayedEvents.length = 0;
  historyCount = 0;
  realtimeCount = 0;
  clearEventsList();

  // Reload
  await loadHistory();
});

// Clear events button
document.getElementById('clear-events')?.addEventListener('click', () => {
  displayedEvents.length = 0;
  historyCount = 0;
  realtimeCount = 0;
  clearEventsList();
  updateStats();
});

function updateConnectionBadge(status: 'connected' | 'disconnected' | 'pending'): void {
  const badge = document.querySelector('#connection-badge .badge');
  if (!badge) return;

  badge.className = `badge badge-${status}`;
  badge.textContent = status === 'connected' ? 'Connected' : status === 'pending' ? 'Connecting...' : 'Disconnected';
}

function updateStats(): void {
  const historyEl = document.getElementById('history-count');
  const realtimeEl = document.getElementById('realtime-count');
  const eventsCountEl = document.getElementById('events-count');

  if (historyEl) historyEl.textContent = String(historyCount);
  if (realtimeEl) realtimeEl.textContent = String(realtimeCount);
  if (eventsCountEl) eventsCountEl.textContent = `${displayedEvents.length} events`;
}

function displayEvent(message: Message, isFromHistory: boolean): void {
  const container = document.getElementById('inventory-list');
  if (!container) return;

  // Remove empty state
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }

  displayedEvents.push(message);

  const payload = message.payload as InventoryPayload | LowStockPayload;
  const time = new Date(message.ts).toLocaleString();
  const historyBadge = isFromHistory
    ? '<span class="badge badge-replayed">From History</span>'
    : '<span class="badge badge-live">Real-time</span>';

  const isLowStock = message.topic === 'inventory.low-stock';
  const cardClass = isLowStock ? 'event-card event-warning' : 'event-card';

  const eventElement = document.createElement('div');
  eventElement.className = `${cardClass} ${isFromHistory ? 'from-history' : 'realtime'}`;
  eventElement.innerHTML = `
    <div class="event-header">
      <span class="event-topic">${message.topic}</span>
      ${historyBadge}
    </div>
    <div class="event-details">
      ${formatPayload(payload)}
    </div>
    <div class="event-footer">
      <span class="event-time">${time}</span>
      <span class="event-id">ID: ${message.id.slice(0, 8)}...</span>
    </div>
  `;

  // Prepend to show newest first
  container.insertBefore(eventElement, container.firstChild);

  // Limit displayed events
  const maxEvents = 50;
  while (container.children.length > maxEvents) {
    container.removeChild(container.lastChild!);
  }

  updateStats();
}

function formatPayload(payload: InventoryPayload | LowStockPayload): string {
  if ('action' in payload) {
    const actionEmoji = payload.action === 'add' ? '📦+' : payload.action === 'remove' ? '📦-' : '📦=';
    return `
      <div class="payload-field">
        <span class="field-icon">${actionEmoji}</span>
        <span class="field-label">SKU:</span>
        <span class="field-value">${payload.sku}</span>
      </div>
      <div class="payload-field">
        <span class="field-label">Action:</span>
        <span class="field-value action-${payload.action}">${payload.action.toUpperCase()}</span>
      </div>
      <div class="payload-field">
        <span class="field-label">Quantity:</span>
        <span class="field-value">${payload.quantity}</span>
      </div>
    `;
  } else {
    return `
      <div class="payload-field">
        <span class="field-icon">⚠️</span>
        <span class="field-label">SKU:</span>
        <span class="field-value">${payload.sku}</span>
      </div>
      <div class="payload-field">
        <span class="field-label">Current:</span>
        <span class="field-value text-danger">${payload.currentQuantity}</span>
      </div>
      <div class="payload-field">
        <span class="field-label">Threshold:</span>
        <span class="field-value">${payload.threshold}</span>
      </div>
    `;
  }
}

function clearEventsList(): void {
  const container = document.getElementById('inventory-list');
  if (!container) return;

  container.innerHTML = `
    <div class="empty-state">
      <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" stroke-width="2"/>
      </svg>
      <p>No inventory events yet. History will load automatically.</p>
    </div>
  `;
}

function showNotification(message: string): void {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

console.log('[Inventory MFE] Initializing...');

initializeAdapters().then(() => {
  console.log('[Inventory MFE] Ready!');
});

// Cleanup on page unload
window.addEventListener('beforeunload', async () => {
  if (historyAdapter) {
    await historyAdapter.detach();
  }
  await crossTabAdapter.detach();
});
