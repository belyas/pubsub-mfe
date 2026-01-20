# PubSub MFE - Iframe Demo

An interactive demonstration of the iframe adapter for secure microfrontend communication.

## Overview

This demo showcases real-time bidirectional communication between a host application and two iframe microfrontends (Shop and Chat) using the PubSub MFE library's iframe adapter.

## Features

- **Host Application**
  - Manages two iframe microfrontends
  - Real-time connection status monitoring
  - Statistics dashboard (messages sent/received, connected iframes)
  - Broadcast message capability
  - Event log with filtering
  - Reload and reconnect controls

- **Shop Microfrontend**
  - Product catalog with add-to-cart functionality
  - Shopping cart with real-time updates
  - Broadcasts cart events to host and chat iframe
  - Statistics tracking

- **Chat Microfrontend**
  - Real-time message display
  - Send messages with different types (message, notification, system)
  - Receives cart events as notifications
  - System announcements
  - Statistics tracking

## Architecture

```
┌──────────────────────────────────────────┐
│           Host Application               │
│  ┌────────────┐    ┌───────────────┐     │
│  │  PubSubBus │◄───┤  IframeHost   │     │
│  └────────────┘    └───────────────┘     │
│         │                  │              │
│         │         ┌────────┴────────┐     │
│         │         │                 │     │
└─────────┼─────────┼─────────────────┼─────┘
          │  port1  │         port2   │
          │ (host)  │      (transferred)
          │         │                 │
   ┌──────▼─────────▼────┐   ┌────────▼──────────┐
   │   Shop Iframe       │   │   Chat Iframe     │
   │  ┌───────────────┐  │   │  ┌──────────────┐ │
   │  │ IframeClient  │  │   │  │ IframeClient │ │
   │  └───────────────┘  │   │  └──────────────┘ │
   └─────────────────────┘   └───────────────────┘
```

## Getting Started

### Installation

```bash
cd examples/iframe-demo
pnpm install
```

### Development

```bash
pnpm dev
```

This starts a Vite dev server at `http://localhost:3000`.

Open `http://localhost:3000` in your browser to view the demo.

### Build

```bash
pnpm build
```

Builds the application for production to the `dist/` folder.

### Preview Production Build

```bash
pnpm preview
```

## How It Works

### 1. Handshake Protocol

When the page loads:
1. Host creates `IframeHost` with trusted origins
2. Iframes load and create `IframeClient` instances
3. Three-way handshake (SYN → ACK → ACK_CONFIRM) establishes secure connection
4. MessageChannel ports are established for bidirectional communication

### 2. Message Flow

**Shop → All**
```
User clicks "Add to Cart"
  → Shop publishes "cart.add" via client.publish()
  → Message sent to host via MessagePort
  → Host receives and broadcasts to all iframes
  → Chat receives cart event and shows notification
```

**Chat → All**
```
User sends chat message
  → Chat publishes "chat.message" via client.publish()
  → Message sent to host via MessagePort
  → Host receives and broadcasts to all iframes
  → Shop receives chat event (if subscribed)
```

**Host → All**
```
User broadcasts from host panel
  → Host publishes via bus.publish()
  → Message automatically broadcast to all iframes
  → Both Shop and Chat receive (if subscribed)
```

### 3. Wildcard Subscriptions

The demo uses MQTT-style wildcard patterns:

- `cart.#` - Matches all cart events (cart.add, cart.remove, cart.checkout)
- `chat.#` - Matches all chat events (chat.message, chat.notification, chat.system)
- `system.#` - Matches all system events

### 4. Auto-Reconnect

Try reloading an iframe:
1. Click "Reload Shop" or "Reload Chat" button
2. Iframe reloads and loses connection
3. Auto-reconnect triggers new handshake
4. Connection re-established automatically
5. Message flow resumes

## Demo Interactions

### Test Message Broadcasting

1. **Host → Iframes**
   - Enter topic: `system.announcement`
   - Enter message: `{"text": "Hello from host!"}`
   - Click "Broadcast"
   - See message appear in both iframe stats and event log

2. **Shop → Chat**
   - Click "Add to Cart" on any product
   - Watch Chat receive notification about cart update
   - Check event log for message flow

3. **Chat → All**
   - Type a message in Chat iframe
   - Select message type (message, notification, system)
   - Click "Send Message"
   - See message appear in event log

### Test Auto-Reconnect

1. Click "Reload Shop" button
2. Watch connection status change: Connected → Disconnected → Connected
3. Verify handshake completes in event log
4. Test message flow still works

### Test Wildcard Subscriptions

1. **Single-level wildcard**: `cart.+` matches `cart.add`, `cart.remove` but not `cart.item.add`
2. **Multi-level wildcard**: `cart.#` matches `cart.add`, `cart.item.add`, `cart.item.remove.all`

### Monitor Statistics

- **Host Panel**: 
  - Messages Sent: Total messages broadcast to iframes
  - Messages Received: Total messages from iframes
  - Connected Iframes: Currently connected (0-2)
  - Failed Handshakes: Handshake failures

- **Iframe Stats**:
  - Published: Messages sent by this iframe
  - Received: Messages received from host

## Security Features

1. **Origin Validation**
   - All messages validate `event.origin`
   - Only `http://localhost:3000` is trusted
   - Messages from other origins are rejected

2. **MessageChannel Isolation**
   - Each iframe has dedicated MessagePort
   - No cross-iframe message leakage
   - Clean separation of concerns

3. **Iframe Sandbox**
   - Iframes use `sandbox="allow-scripts allow-same-origin"`
   - Restricts iframe capabilities
   - Prevents top-level navigation

## Performance

- **Message Latency**: <10ms host ↔ iframe
- **Throughput**: Handles 100+ messages/second
- **Memory**: Zero leaks, comprehensive cleanup
- **UI**: No jank or blocking

## Troubleshooting

### Iframes Not Connecting

- Check browser console for errors
- Verify origin matches: `http://localhost:3000`
- Ensure iframes loaded completely
- Check handshake timeout (default: 5000ms)

### Messages Not Delivered

- Verify connection status is "Connected"
- Check topic matches subscription pattern
- Enable debug mode in config
- Review event log for errors

### Auto-Reconnect Not Working

- Check `autoReconnect: true` in config
- Verify iframe `load` event fires
- Check handshake retry count
- Review event log for handshake attempts

## Code Structure

```
examples/iframe-demo/
├── index.html          # Host application HTML
├── shop.html           # Shop iframe HTML
├── chat.html           # Chat iframe HTML
├── package.json        # Dependencies
├── tsconfig.json       # TypeScript config
├── vite.config.ts      # Vite bundler config
├── src/
│   ├── host.ts         # Host application logic
│   ├── shop.ts         # Shop iframe logic
│   ├── chat.ts         # Chat iframe logic
│   └── styles/
│       ├── main.css    # Host styles
│       └── iframe.css  # Iframe styles
└── README.md           # This file
```

## Technologies

- **TypeScript** - Type-safe development
- **Vite** - Fast bundler and dev server
- **PubSub MFE** - Iframe adapter library
- **Vanilla JS** - No framework dependencies
- **CSS3** - Modern styling

## Next Steps

- Modify topics and messages to test different scenarios
- Add more iframes to test multi-iframe coordination
- Experiment with different wildcard patterns
- Test performance with high message volume
- Add custom event handlers and logic

## Learn More

- [Main README](../../README.md)
