/**
 * Dashboard - Main control panel for the History Demo.
 *
 * Demonstrates:
 * - History Adapter with IndexedDB persistence
 * - Cross-Tab Adapter for real-time sync
 * - Publishing events that persist across tabs
 * - Querying historical messages with wildcards
 * - Garbage collection management
 */
import { createPubSub } from '@pubsub/index';
import { createCrossTabAdapter, BroadcastChannelTransport } from '@pubsub/adapters/cross-tab/index';
import { createHistoryAdapter } from '@pubsub/adapters/history/index';
import type { Message } from '@pubsub/types';

const bus = createPubSub({
  debug: true,
  app: 'history-demo',
});
const transport = new BroadcastChannelTransport({ channelName: 'history-demo' });
const crossTabAdapter = createCrossTabAdapter({
  channelName: 'history-demo',
  transport,
  debug: true,
  dedupeWindowMs: 5000,
});

// Create History Adapter with IndexedDB persistence (async lazy-load)
let historyAdapter: Awaited<ReturnType<typeof createHistoryAdapter>> | null = null;

async function initializeAdapters(): Promise<void> {
  try {
    crossTabAdapter.attach(bus);
    updateStatus('crosstab-status', 'connected');
    logEvent('system', 'Cross-Tab Adapter attached', 'info');

    // Create and attach history adapter
    historyAdapter = await createHistoryAdapter({
      namespace: 'history-demo',
      maxMessages: 100, // Low limit to demonstrate GC
      ttlSeconds: 300, // 5 minutes TTL
      gcIntervalMs: 30000, // GC every 30 seconds
      debug: true,
      onError: (error) => {
        logEvent('history', `Error: ${error.message}`, 'error');
      },
    });

    await historyAdapter.attach(bus);
    updateStatus('history-status', 'connected');
    logEvent('system', 'History Adapter attached (IndexedDB ready)', 'info');

    // Update stats
    await refreshStats();
  } catch (error) {
    logEvent('system', `Failed to initialize adapters: ${(error as Error).message}`, 'error');
    updateStatus('history-status', 'disconnected');
    updateStatus('crosstab-status', 'disconnected');
  }
}

// Subscribe to all order events
bus.subscribe('orders.#', (message) => {
  logEvent('orders', `${message.topic}`, 'info', message.payload);
  refreshStats();
});

// Subscribe to all inventory events
bus.subscribe('inventory.#', (message) => {
  logEvent('inventory', `${message.topic}`, 'info', message.payload);
  refreshStats();
});

// Subscribe to system events
bus.subscribe('system.#', (message) => {
  logEvent('system', `${message.topic}`, 'warn', message.payload);
  refreshStats();
});

// ============================================================================
// UI Event Handlers
// ============================================================================

// Publish form
const publishForm = document.getElementById('publish-form') as HTMLFormElement;
publishForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const topic = (document.getElementById('topic') as HTMLSelectElement).value?.trim();
  const payloadText = (document.getElementById('payload') as HTMLTextAreaElement).value?.trim();

  try {
    const payload = JSON.parse(payloadText);

    bus.publish(topic, payload, { source: 'dashboard' });
    logEvent('dashboard', `Published to ${topic}`, 'info', payload);
  } catch {
    logEvent('dashboard', 'Invalid JSON payload', 'error');
  }
});

// Query history form
const queryForm = document.getElementById('query-form') as HTMLFormElement;
queryForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!historyAdapter) {
    logEvent('dashboard', 'History adapter not ready', 'error');
    return;
  }

  const topic = (document.getElementById('query-topic') as HTMLInputElement).value.trim() || '#';
  const limit = parseInt((document.getElementById('query-limit') as HTMLInputElement).value, 10) || 10;
  const fromMinutes = parseInt((document.getElementById('query-from') as HTMLInputElement).value, 10) || 60;
  const fromTime = Date.now() - fromMinutes * 60 * 1000;

  logEvent('dashboard', `Querying history: topic="${topic}", limit=${limit}, from=${fromMinutes}min ago`, 'info');

  try {
    const messages = await historyAdapter.getHistory(topic, { limit, fromTime });

    displayHistoryResults(messages);
    logEvent('dashboard', `Found ${messages.length} messages in history`, 'info');
  } catch (error) {
    logEvent('dashboard', `Query failed: ${(error as Error).message}`, 'error');
  }
});

// Clear history button
document.getElementById('clear-history')?.addEventListener('click', async () => {
  if (!historyAdapter) return;

  if (confirm('Are you sure you want to clear all message history?')) {
    try {
      await historyAdapter.clearHistory();

      logEvent('dashboard', 'All history cleared', 'warn');
      await refreshStats();
      displayHistoryResults([]);
    } catch (error) {
      logEvent('dashboard', `Clear failed: ${(error as Error).message}`, 'error');
    }
  }
});

// Force GC button
document.getElementById('force-gc')?.addEventListener('click', async () => {
  if (!historyAdapter) return;

  logEvent('dashboard', 'Forcing garbage collection...', 'info');
  try {
    await historyAdapter.forceGc();
    logEvent('dashboard', 'GC completed', 'info');
    await refreshStats();
  } catch (error) {
    logEvent('dashboard', `GC failed: ${(error as Error).message}`, 'error');
  }
});

// Refresh stats button
document.getElementById('refresh-stats')?.addEventListener('click', () => {
  refreshStats();
});

// Clear log button
document.getElementById('clear-log')?.addEventListener('click', () => {
  const logContainer = document.getElementById('event-log');
  if (logContainer) {
    logContainer.innerHTML = '';
  }
});

function updateStatus(elementId: string, status: 'connected' | 'disconnected' | 'pending'): void {
  const container = document.getElementById(elementId);
  if (!container) return;

  const indicator = container.querySelector('.status-indicator');
  if (indicator) {
    indicator.className = `status-indicator status-${status}`;
  }
}

async function refreshStats(): Promise<void> {
  if (!historyAdapter) return;

  try {
    const stats = await historyAdapter.getStats();
    const messagesStored = document.getElementById('messages-stored');
    const messagesGc = document.getElementById('messages-gc');
    const duplicatesSkipped = document.getElementById('duplicates-skipped');
    const gcCycles = document.getElementById('gc-cycles');

    if (messagesStored) messagesStored.textContent = String(stats.estimatedStorageCount);
    if (messagesGc) messagesGc.textContent = String(stats.messagesGarbageCollected);
    if (duplicatesSkipped) duplicatesSkipped.textContent = String(stats.duplicatesSkipped);
    if (gcCycles) gcCycles.textContent = String(stats.gcCyclesCompleted);
  } catch (error) {
    console.error('Failed to refresh stats:', error);
  }
}

function logEvent(source: string, message: string, level: 'info' | 'warn' | 'error' = 'info', payload?: unknown): void {
  const logContainer = document.getElementById('event-log');
  if (!logContainer) return;

  const entry = document.createElement('div');
  entry.className = `log-entry log-${level}`;

  const time = new Date().toLocaleTimeString('en-US', { hour12: false });

  let payloadHtml = '';
  if (payload !== undefined) {
    payloadHtml = `<pre class="log-payload">${JSON.stringify(payload, null, 2)}</pre>`;
  }

  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-source log-source-${source}">${source}</span>
    <span class="log-message">${message}</span>
    ${payloadHtml}
  `;

  // Prepend to show newest first
  logContainer.insertBefore(entry, logContainer.firstChild);

  // Limit log entries
  const maxEntries = 100;
  while (logContainer.children.length > maxEntries) {
    logContainer.removeChild(logContainer.lastChild!);
  }
}

function displayHistoryResults(messages: Message[]): void {
  const container = document.getElementById('history-results');
  const countBadge = document.getElementById('query-count');

  if (!container) return;

  if (countBadge) {
    countBadge.textContent = `${messages.length} message${messages.length !== 1 ? 's' : ''}`;
  }

  if (messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="10" stroke-width="2"/>
          <line x1="12" y1="8" x2="12" y2="12" stroke-width="2" stroke-linecap="round"/>
          <line x1="12" y1="16" x2="12.01" y2="16" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <p>No messages found matching the query.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = messages
    .map((msg) => {
      const time = new Date(msg.ts).toLocaleString();
      return `
        <div class="history-item">
          <div class="history-header">
            <span class="history-topic">${msg.topic}</span>
            <span class="history-time">${time}</span>
          </div>
          <div class="history-id">ID: ${msg.id}</div>
          <pre class="history-payload">${JSON.stringify(msg.payload, null, 2)}</pre>
        </div>
      `;
    })
    .join('');
}

logEvent('system', 'Dashboard loading...', 'info');

initializeAdapters().then(() => {
  logEvent('system', 'Dashboard ready! Open Orders or Inventory tabs to test cross-tab history.', 'info');
});

// Cleanup on page unload
window.addEventListener('beforeunload', async () => {
  if (historyAdapter) {
    await historyAdapter.detach();
  }
  await crossTabAdapter.detach();
});
