import { createIframeClient } from '@pubsub/adapters/iframe/index';

const origin = window.location.origin;
// Cart state
const cart: Array<{ id: string; name: string; price: number }> = [];

async function init() {
  try {
    const client = await createIframeClient({
      expectedHostOrigin: origin,
      handshakeTimeout: 5000,
      autoReconnect: true,
      debug: true,
      onConnected: (hostClientId: string) => {
        console.log('[Shop] Connected to host:', hostClientId);
        updateConnectionStatus('connected');
        updateStats();
      },
      onDisconnected: (reason: string) => {
        console.log('[Shop] Disconnected from host:', reason);
        updateConnectionStatus('disconnected');
      },
    });

    console.log('[Shop] Client initialized');

    // Subscribe to cart updates from other sources
    client.subscribe('cart.#', (message) => {
      console.log('[Shop] Received cart event:', message.topic, message.payload);
      updateStats();
    });

    // Subscribe to system announcements
    client.subscribe('system.#', (message) => {
      console.log('[Shop] System announcement:', message.payload);
      showNotification('System', JSON.stringify(message.payload));
      updateStats();
    });

    // Subscribe to chat notifications
    client.subscribe('chat.#', (message) => {
      console.log('[Shop] Chat event:', message.payload);
      updateStats();
    });

    // Add to cart buttons
    const addToCartButtons = document.querySelectorAll('.btn-add-to-cart');
    addToCartButtons.forEach(button => {
      button.addEventListener('click', () => {
        const productData = (button as HTMLElement).dataset.product;
        if (!productData) return;

        const product = JSON.parse(productData);
        addToCart(product);

        // Publish cart.add event
        client.publish('cart.add', {
          product,
          timestamp: Date.now(),
        });

        updateStats();
      });
    });

    // Checkout button
    document.getElementById('checkout-btn')?.addEventListener('click', () => {
      if (cart.length === 0) return;

      // Publish checkout event
      client.publish('cart.checkout', {
        items: cart,
        total: calculateTotal(),
        timestamp: Date.now(),
      });

      showNotification('Checkout', 'Checkout process initiated!');
      updateStats();
    });

    // Update stats periodically
    setInterval(() => {
      const stats = client.getStats();
      updateStatValue('messages-published', stats.messagesPublished);
      updateStatValue('messages-received', stats.messagesReceived);
    }, 1000);

  } catch (error) {
    console.error('[Shop] Failed to initialize:', error);
    updateConnectionStatus('disconnected');
  }
}

// Add product to cart
function addToCart(product: { id: string; name: string; price: number }) {
  cart.push(product);
  renderCart();
  showNotification('Cart', `Added ${product.name} to cart`);
}

// Remove product from cart
function removeFromCart(index: number) {
  const product = cart[index];
  cart.splice(index, 1);
  renderCart();
  showNotification('Cart', `Removed ${product.name} from cart`);
}

// Render cart
function renderCart() {
  const cartItems = document.getElementById('cart-items');
  const cartCount = document.getElementById('cart-count');
  const cartTotalSection = document.getElementById('cart-total-section');
  const cartTotalValue = document.getElementById('cart-total');
  const checkoutBtn = document.getElementById('checkout-btn');

  if (!cartItems || !cartCount) return;

  // Update cart count badge
  cartCount.textContent = cart.length.toString();

  if (cart.length === 0) {
    cartItems.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="9" cy="21" r="1" stroke-width="2"/>
          <circle cx="20" cy="21" r="1" stroke-width="2"/>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p>Your cart is empty</p>
      </div>
    `;
    cartTotalSection?.style.setProperty('display', 'none');
    checkoutBtn?.style.setProperty('display', 'none');
  } else {
    cartItems.innerHTML = cart.map((item, index) => `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(item.name)}</div>
          <div class="cart-item-price">$${item.price.toFixed(2)}</div>
        </div>
        <button class="btn-remove" data-index="${index}">Remove</button>
      </div>
    `).join('');

    // Add remove button listeners
    cartItems.querySelectorAll('.btn-remove').forEach(button => {
      button.addEventListener('click', () => {
        const index = parseInt((button as HTMLElement).dataset.index || '0');
        removeFromCart(index);
      });
    });

    // Update total
    const total = calculateTotal();
    if (cartTotalValue) {
      cartTotalValue.textContent = `$${total.toFixed(2)}`;
    }
    cartTotalSection?.style.setProperty('display', 'flex');
    checkoutBtn?.style.setProperty('display', 'block');
  }
}

// Calculate cart total
function calculateTotal(): number {
  return cart.reduce((sum, item) => sum + item.price, 0);
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

// Show notification
function showNotification(title: string, message: string) {
  console.log(`[Shop] ${title}: ${message}`);
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize
init();
