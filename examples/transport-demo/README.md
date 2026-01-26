# Transport Demo

Interactive demo application for testing PubSub MFE cross-tab communication transports.

## Features

- **Transport Selection**: Choose between Auto, SharedWorker, BroadcastChannel, and Storage transports
- **Real-time Status**: Monitor connection state, client ID, and message counts
- **Message Testing**: Send and receive messages across browser tabs
- **Quick Actions**: Pre-built test scenarios (broadcast, spam, large payloads, stress tests)
- **Fallback Monitoring**: Track transport fallback events in real-time
- **Message Log**: View sent/received messages with timestamps and metadata

## Getting Started

### Installation

```bash
cd examples/transport-demo
pnpm install
```

### Running the Demo

```bash
pnpm dev
```

The demo will open at `http://localhost:5174`

## How to Use

### Basic Testing

1. **Select a Transport**: Choose from Auto (recommended), SharedWorker, BroadcastChannel, or Storage
2. **Connect**: Click the "Connect" button to initialize the transport
3. **Open Multiple Tabs**: Open the same URL in multiple browser tabs/windows
4. **Send Messages**: Type a message and click "Send" or press Enter
5. **Observe**: Watch messages appear in all connected tabs

### Testing Scenarios

#### 1. Cross-Tab Communication
- Open 2-3 tabs
- Connect with the same transport in each
- Send messages from one tab
- Verify they appear in all other tabs

#### 2. Transport Fallback
- Select "Auto" transport
- Connect in a tab
- Open DevTools → Application → Storage
- Disable the primary transport (e.g., close SharedWorker)
- Send a message and observe fallback in the Fallback Log

#### 3. Large Payload Testing
- Click "📦 Large Payload" button
- Sends a message with 100 items of data
- Verifies transport can handle larger payloads

#### 4. Stress Testing
- Click "⚡ Stress Test" button
- Sends 100 messages rapidly (one every 50ms)
- Tests transport performance under load

### Transport Comparison

| Transport | Pros | Cons | Use Case |
|-----------|------|------|----------|
| **SharedWorker** | Centralized, efficient, persistent | Requires HTTPS in production | Best for production apps |
| **BroadcastChannel** | Simple, fast, native | Only same-origin tabs | General purpose |
| **Storage** | Universal compatibility | Slower, storage-dependent | Fallback option |
| **Auto** | Intelligent fallback | Additional complexity | Recommended default |

## Quick Actions

- **📢 Broadcast**: Send a simple test message
- **🔥 Spam Test**: Send 10 messages rapidly
- **📦 Large Payload**: Send a message with 100 data items
- **⚡ Stress Test**: Send 100 messages in 5 seconds

## Tips

### For SharedWorker Transport
- Works best on localhost or HTTPS
- Check DevTools → Application → Shared Workers to see the worker
- Messages are relayed through a central broker

### For BroadcastChannel Transport
- Very fast and simple
- No worker overhead
- Limited to same-origin tabs

### For Storage Transport
- Uses localStorage for communication
- Slower but works everywhere
- Messages auto-expire after 30 seconds

### For Auto Transport
- Automatically selects best available transport
- Falls back gracefully if primary fails
- Check "Fallback Chain" in status panel

## Development

### Project Structure

```
transport-demo/
├── src/
│   ├── main.ts           # Application logic
│   └── styles/
│       └── main.css      # Styling
├── index.html            # UI structure
├── package.json          # Dependencies
├── tsconfig.json         # TypeScript config
└── vite.config.ts        # Vite bundler config
```

### Building for Production

```bash
pnpm build
```

Output will be in `dist/` directory.

### Type Checking

```bash
pnpm type-check
```

## Troubleshooting

### SharedWorker not available
- Ensure you're on `http://localhost` or `https://`
- Check browser support (most modern browsers)
- Try using "Auto" transport instead

### Messages not appearing in other tabs
- Ensure all tabs are connected (green status)
- Check that all tabs use the same transport
- Look for errors in the message log

### Storage transport slow
- Expected behavior - uses localStorage events
- Messages have ~30ms latency
- Consider using SharedWorker or BroadcastChannel for better performance

## Browser Support

- **SharedWorker**: Chrome 89+, Edge 89+, Firefox 29+
- **BroadcastChannel**: Chrome 54+, Edge 79+, Firefox 38+, Safari 15.4+
- **Storage**: All browsers (universal fallback)

## License

MIT
