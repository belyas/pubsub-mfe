import { createPubSub } from '@belyas/pubsub-mfe';
import { createIframeHost } from '@belyas/pubsub-mfe/adapters/iframe';

const origin = window.location.origin;

const bus = createPubSub({ debug: false });

const iframeHost = createIframeHost(bus, {
  trustedOrigins: [origin],
  handshakeTimeout: 5000,
  maxRetries: 2,
  autoReconnect: true,
  debug: true,
  onHandshakeComplete: (iframe: HTMLIFrameElement, clientId: string) => {
    logEvent('host', `Handshake complete with ${iframe.id}: ${clientId}`);
    updateConnectionStatus(iframe.id, 'connected');
    updateStats();
  },
  onHandshakeFailed: (iframe: HTMLIFrameElement, _iframeOrigin: string, error: Error) => {
    logEvent('host', `Handshake failed with ${iframe.id}: ${error.message}`, 'error');
    updateConnectionStatus(iframe.id, 'disconnected');
  },
  onIframeDisconnected: (iframe: HTMLIFrameElement, reason: string) => {
    logEvent('host', `Iframe ${iframe.id} disconnected: ${reason}`, 'warn');
    updateConnectionStatus(iframe.id, 'disconnected');
    updateStats();
  },
});

// Get iframe elements
const shopIframe = document.getElementById('shop-iframe') as HTMLIFrameElement;
const chatIframe = document.getElementById('chat-iframe') as HTMLIFrameElement;

shopIframe.addEventListener('load', () => {
  iframeHost.registerIframe(shopIframe, origin);
  logEvent('host', 'Shop iframe loaded, initiating handshake...');
});

chatIframe.addEventListener('load', () => {
  iframeHost.registerIframe(chatIframe, origin);
  logEvent('host', 'Chat iframe loaded, initiating handshake...');
});

bus.subscribe('cart.#', (message) => {
  logEvent('host', `Received cart event: ${message.topic}`, 'info', message.payload);
  updateStats();
});

bus.subscribe('chat.#', (message) => {
  logEvent('host', `Received chat event: ${message.topic}`, 'info', message.payload);
  updateStats();
});

bus.subscribe('system.#', (message) => {
  logEvent('host', `Received system event: ${message.topic}`, 'info', message.payload);
  updateStats();
});

const broadcastForm = document.getElementById('broadcast-form') as HTMLFormElement;

broadcastForm.addEventListener('submit', (e) => {
  e.preventDefault();
  
  const topicInput = document.getElementById('topic') as HTMLInputElement;
  const messageInput = document.getElementById('message') as HTMLTextAreaElement;
  
  const topic = topicInput.value.trim();
  const messageText = messageInput.value.trim();
  
  if (!topic || !messageText) {
    alert('Please enter both topic and message');
    return;
  }
  
  try {
    const payload = JSON.parse(messageText);

    bus.publish(topic, payload, { source: 'host' });
    logEvent('host', `Broadcasted message to ${topic}`, 'info', payload);
    updateStats();
  } catch (error) {
    alert('Invalid JSON in message field');
  }
});

// Reload buttons
document.getElementById('reload-shop')?.addEventListener('click', () => {
  logEvent('host', 'Reloading shop iframe...');
  shopIframe.src = shopIframe.src;
});

document.getElementById('reload-chat')?.addEventListener('click', () => {
  logEvent('host', 'Reloading chat iframe...');
  chatIframe.src = chatIframe.src;
});

document.getElementById('clear-log')?.addEventListener('click', () => {
  const logContent = document.getElementById('event-log');
  if (logContent) {
    logContent.innerHTML = '';
  }
});

const filterHost = document.getElementById('filter-host') as HTMLInputElement;
const filterShop = document.getElementById('filter-shop') as HTMLInputElement;
const filterChat = document.getElementById('filter-chat') as HTMLInputElement;

[filterHost, filterShop, filterChat].forEach(checkbox => {
  checkbox.addEventListener('change', updateLogVisibility);
});

// Helper: Update connection status
function updateConnectionStatus(iframeId: string, status: 'pending' | 'connected' | 'disconnected') {
  const statusElement = document.getElementById(`${iframeId}-status`);
  if (!statusElement) return;
  
  const indicator = statusElement.querySelector('.status-indicator');
  if (!indicator) return;
  
  indicator.classList.remove('status-pending', 'status-connected', 'status-disconnected');
  indicator.classList.add(`status-${status}`);
}

// Helper: Update statistics
function updateStats() {
  const stats = iframeHost.getStats();
  
  updateStatValue('messages-sent', stats.messagesSent);
  updateStatValue('messages-received', stats.messagesReceived);
  updateStatValue('connected-iframes', stats.connectedIframes);
  updateStatValue('handshakes-failed', stats.handshakesFailed);
}

function updateStatValue(id: string, value: number) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value.toString();
  }
}

// Helper: Log event
function logEvent(source: 'host' | 'shop' | 'chat', message: string, level: 'info' | 'warn' | 'error' = 'info', data?: unknown) {
  const logContent = document.getElementById('event-log');
  if (!logContent) return;
  
  const entry = document.createElement('div');
  entry.className = `log-entry source-${source}`;
  entry.dataset.source = source;
  
  const timestamp = new Date().toLocaleTimeString('en-US', { 
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  
  let logHTML = `
    <div class="log-timestamp">[${timestamp}]</div>
    <span class="log-source ${source}">${source.toUpperCase()}</span>
    <div class="log-message">${escapeHtml(message)}</div>
  `;
  
  if (data) {
    logHTML += `<div class="log-message" style="margin-top: 0.25rem; opacity: 0.7;">${escapeHtml(JSON.stringify(data, null, 2))}</div>`;
  }
  
  entry.innerHTML = logHTML;
  
  // Add to log
  logContent.appendChild(entry);
  
  // Auto-scroll to bottom
  logContent.scrollTop = logContent.scrollHeight;
  
  // Update visibility based on filters
  updateLogVisibility();
}

function updateLogVisibility() {
  const showHost = (document.getElementById('filter-host') as HTMLInputElement).checked;
  const showShop = (document.getElementById('filter-shop') as HTMLInputElement).checked;
  const showChat = (document.getElementById('filter-chat') as HTMLInputElement).checked;
  
  const entries = document.querySelectorAll('.log-entry');
  entries.forEach(entry => {
    const source = (entry as HTMLElement).dataset.source;
    const shouldShow = 
      (source === 'host' && showHost) ||
      (source === 'shop' && showShop) ||
      (source === 'chat' && showChat);
    
    entry.classList.toggle('visible', shouldShow);
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initial log
logEvent('host', 'PubSub MFE Demo initialized');
logEvent('host', `Trusted origin: ${origin}`);
logEvent('host', 'Waiting for iframes to load...');

// Update stats every second
setInterval(updateStats, 1000);
