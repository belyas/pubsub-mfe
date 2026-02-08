import { createIframeClient } from '@belyas/pubsub-mfe/adapters/iframe';

const origin = window.location.origin;
// Messages state
const messages: Array<{ source: string; text: string; type: string; timestamp: number }> = [];
const notifications: Array<{ text: string; timestamp: number }> = [];

// Initialize client
async function init() {
  try {
    const client = await createIframeClient({
      expectedHostOrigin: origin,
      handshakeTimeout: 5000,
      autoReconnect: true,
      debug: true,
      onConnected: (hostClientId: string) => {
        console.log('[Chat] Connected to host:', hostClientId);
        updateConnectionStatus('connected');
        addMessage('system', 'Connected to host', 'chat.system');
        updateStats();
      },
      onDisconnected: (reason: string) => {
        console.log('[Chat] Disconnected from host:', reason);
        updateConnectionStatus('disconnected');
        addMessage('system', `Disconnected: ${reason}`, 'chat.system');
      },
    });

    console.log('[Chat] Client initialized');

    // Subscribe to all chat messages
    client.subscribe('chat.#', (message) => {
      console.log('[Chat] Received chat message:', message.topic, message.payload);
      
      if (message.topic.startsWith('chat.notification')) {
        addNotification(JSON.stringify(message.payload));
      } else {
        const source = message?.source || 'unknown';
        const text = typeof message.payload === 'string' 
          ? message.payload 
          : JSON.stringify(message.payload);
        addMessage(source, text, message.topic);
      }
      
      updateStats();
    });

    // Subscribe to cart events
    client.subscribe('cart.#', (message) => {
      console.log('[Chat] Cart event:', message.topic, message.payload);
      
      if (message.topic === 'cart.add') {
        const product = (message.payload as any).product;
        addNotification(`Item added to cart: ${product?.name}`);
      } else if (message.topic === 'cart.checkout') {
        const total = (message.payload as any).total;
        addNotification(`Checkout initiated: $${total?.toFixed(2)}`);
      }
      
      updateStats();
    });

    // Subscribe to system announcements
    client.subscribe('system.#', (message) => {
      console.log('[Chat] System announcement:', message.payload);
      const text = typeof message.payload === 'string'
        ? message.payload
        : JSON.stringify(message.payload);
      addMessage('system', text, 'chat.system');
      addNotification(`System: ${text}`);
      updateStats();
    });

    // Message form
    const messageForm = document.getElementById('message-form') as HTMLFormElement;
    messageForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const messageType = (document.getElementById('message-type') as HTMLSelectElement).value;
      const messageText = (document.getElementById('message-text') as HTMLTextAreaElement).value.trim();

      if (!messageText) {
        alert('Please enter a message');
        return;
      }

      // Publish message
      client.publish(messageType, {
        text: messageText,
        timestamp: Date.now(),
      });

      // Add to own messages
      addMessage('you', messageText, messageType);

      // Clear form
      (document.getElementById('message-text') as HTMLTextAreaElement).value = '';

      updateStats();
    });

    // Update stats periodically
    setInterval(() => {
      const stats = client.getStats();
      updateStatValue('messages-published', stats.messagesPublished);
      updateStatValue('messages-received', stats.messagesReceived);
    }, 1000);

  } catch (error) {
    console.error('[Chat] Failed to initialize:', error);
    updateConnectionStatus('disconnected');
  }
}

// Add message
function addMessage(source: string, text: string, type: string) {
  messages.push({ source, text, type, timestamp: Date.now() });
  renderMessages();
}

// Add notification
function addNotification(text: string) {
  notifications.push({ text, timestamp: Date.now() });
  renderNotifications();
}

// Render messages
function renderMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  if (messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="9" y1="9" x2="15" y2="9" stroke-width="2" stroke-linecap="round"/>
          <line x1="9" y1="13" x2="15" y2="13" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <p>No messages yet</p>
      </div>
    `;
  } else {
    const lastMessages = messages.slice(-10); // Show last 10 messages
    container.innerHTML = lastMessages.map(msg => {
      const messageTypeClass = msg.type.includes('notification') ? 'type-notification' 
        : msg.type.includes('system') ? 'type-system' 
        : '';
      const time = new Date(msg.timestamp).toLocaleTimeString('en-US', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      return `
        <div class="message ${messageTypeClass}">
          <div class="message-header">
            <span class="message-source">${escapeHtml(msg.source)}</span>
            <span class="message-time">${time}</span>
          </div>
          <div class="message-text">${escapeHtml(msg.text)}</div>
        </div>
      `;
    }).join('');
  }

  // Auto-scroll to bottom
  container.scrollTop = container.scrollHeight;
}

// Render notifications
function renderNotifications() {
  const container = document.getElementById('notifications');
  if (!container) return;

  if (notifications.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p>No notifications</p>
      </div>
    `;
  } else {
    const lastNotifications = notifications.slice(-5); // Show last 5 notifications
    container.innerHTML = lastNotifications.map(notif => {
      const time = new Date(notif.timestamp).toLocaleTimeString('en-US', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      return `
        <div class="notification-item">
          ${escapeHtml(notif.text)}
          <div class="notification-time">${time}</div>
        </div>
      `;
    }).join('');
  }

  // Auto-scroll to bottom
  container.scrollTop = container.scrollHeight;
}

// Update connection status
function updateConnectionStatus(status: 'connected' | 'disconnected') {
  const badge = document.getElementById('connection-status');
  if (!badge) return;

  badge.classList.remove('connected', 'disconnected');
  badge.classList.add(status);

  const text = badge.querySelector('.badge-text');
  if (text) {
    text.textContent = status === 'connected' ? 'Connected' : 'Disconnected';
  }
}

// Update statistics
function updateStats() {
  // Stats are updated via setInterval in init()
}

function updateStatValue(id: string, value: number) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value.toString();
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize
init();
