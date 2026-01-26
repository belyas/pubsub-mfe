import {
  createAutoTransport,
  createTransport,
  createSharedWorkerTransport,
  type TransportType,
  type AutoTransportResult,
  type Transport,
} from "@pubsub/adapters/cross-tab";

// State
let transport: Transport | null = null;
let transportResult: AutoTransportResult | null = null;
let sentCount = 0;
let receivedCount = 0;
const fallbackLogs: string[] = [];

// DOM Elements
const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
const disconnectBtn = document.getElementById("disconnect-btn") as HTMLButtonElement;
const messageInput = document.getElementById("message-input") as HTMLInputElement;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
const clearLogBtn = document.getElementById("clear-log-btn") as HTMLButtonElement;
const messageLog = document.getElementById("message-log") as HTMLDivElement;
const fallbackLog = document.getElementById("fallback-log") as HTMLDivElement;

// Status elements
const transportTypeEl = document.getElementById("transport-type") as HTMLSpanElement;
const connectionStatusEl = document.getElementById("connection-status") as HTMLSpanElement;
const clientIdEl = document.getElementById("client-id") as HTMLSpanElement;
const sentCountEl = document.getElementById("sent-count") as HTMLSpanElement;
const receivedCountEl = document.getElementById("received-count") as HTMLSpanElement;
const fallbackChainEl = document.getElementById("fallback-chain") as HTMLSpanElement;

// Get selected transport
function getSelectedTransport(): string {
  const selected = document.querySelector<HTMLInputElement>('input[name="transport"]:checked');
  return selected?.value || "auto";
}

// Update status UI
function updateStatus(connected: boolean) {
  connectionStatusEl.textContent = connected ? "Connected" : "Disconnected";
  connectionStatusEl.className = connected ? "status-value status-connected" : "status-value status-disconnected";
  
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;
  messageInput.disabled = !connected;
  sendBtn.disabled = !connected;
  
  const transportRadios = document.querySelectorAll<HTMLInputElement>('input[name="transport"]');
  transportRadios.forEach(radio => {
    radio.disabled = connected;
  });
}

// Log message
function logMessage(type: "sent" | "received" | "info" | "error", message: string, data?: unknown) {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = document.createElement("div");
  logEntry.className = `log-entry log-${type}`;
  
  const timeSpan = document.createElement("span");
  timeSpan.className = "log-time";
  timeSpan.textContent = timestamp;
  
  const typeSpan = document.createElement("span");
  typeSpan.className = "log-type";
  typeSpan.textContent = type.toUpperCase();
  
  const messageSpan = document.createElement("span");
  messageSpan.className = "log-message";
  messageSpan.textContent = message;
  
  logEntry.appendChild(timeSpan);
  logEntry.appendChild(typeSpan);
  logEntry.appendChild(messageSpan);
  
  if (data) {
    const dataSpan = document.createElement("pre");
    dataSpan.className = "log-data";
    dataSpan.textContent = JSON.stringify(data, null, 2);
    logEntry.appendChild(dataSpan);
  }
  
  messageLog.insertBefore(logEntry, messageLog.firstChild);
  
  // Keep only last 100 messages
  while (messageLog.children.length > 100) {
    messageLog.removeChild(messageLog.lastChild!);
  }
}

// Log fallback event
function logFallback(from: TransportType, to: TransportType, reason: string) {
  const fallbackMsg = `Fallback: ${from} → ${to} (${reason})`;
  fallbackLogs.push(fallbackMsg);
  
  const fallbackEntry = document.createElement("div");
  fallbackEntry.className = "fallback-entry";
  fallbackEntry.textContent = `⚠️ ${fallbackMsg}`;
  fallbackLog.appendChild(fallbackEntry);
  
  logMessage("info", `Transport fallback: ${from} → ${to}`, { reason });
}

// Connect transport
async function connect() {
  try {
    const selectedType = getSelectedTransport();
    logMessage("info", `Connecting with ${selectedType} transport...`);
    
    if (selectedType === "auto") {
      transportResult = createAutoTransport({
        channelName: "transport-demo",
        debug: true,
        onFallback: logFallback,
        onError: (error) => {
          logMessage("error", `Transport error: ${error.message}`);
        },
      });
      
      transport = transportResult.transport;
      transportTypeEl.textContent = transportResult.type;
      fallbackChainEl.textContent = transportResult.fallbackChain.join(" → ");
      
      logMessage("info", `Auto-selected: ${transportResult.type}`);
      logMessage("info", `Fallback chain: ${transportResult.fallbackChain.join(" → ")}`);
    } else {
      // Handle SharedWorker specially to provide worker URL
      if (selectedType === "sharedworker") {
        // Compute worker URL
        const workerUrl = new URL("../../../dist/workers/cross-tab-shared-worker-broker.js", import.meta.url).href;
        console.log('[Demo] Worker URL:', workerUrl);
        
        transport = createSharedWorkerTransport({
          channelName: "transport-demo",
          workerUrl,
          debug: true,
          onError: (error: Error) => {
            logMessage("error", `Transport error: ${error.message}`);
          },
        });
      } else {
        transport = createTransport(selectedType as TransportType, {
          channelName: "transport-demo",
          debug: true,
          onError: (error: Error) => {
            logMessage("error", `Transport error: ${error.message}`);
          },
        });
      }
      
      transportTypeEl.textContent = selectedType;
      fallbackChainEl.textContent = "-";
    }
    
    // Get client ID
    if ("getClientId" in transport) {
      const clientId = (transport as { getClientId: () => string }).getClientId();
      clientIdEl.textContent = clientId.substring(0, 8) + "...";
    }
    
    // Subscribe to messages
    transport.onMessage((envelope) => {
      receivedCount++;
      receivedCountEl.textContent = receivedCount.toString();
      
      logMessage("received", envelope.payload.message || JSON.stringify(envelope.payload), {
        from: envelope.clientId.substring(0, 8),
        topic: envelope.topic,
        messageId: envelope.messageId,
      });
      
      return () => {}; // Cleanup function
    });
    
    updateStatus(true);
    logMessage("info", "Connected successfully!");
    
  } catch (error) {
    logMessage("error", `Connection failed: ${error instanceof Error ? error.message : String(error)}`);
    updateStatus(false);
  }
}

// Disconnect transport
function disconnect() {
  if (transport) {
    transport.close();
    transport = null;
    transportResult = null;
    sentCount = 0;
    receivedCount = 0;
    
    transportTypeEl.textContent = "-";
    clientIdEl.textContent = "-";
    sentCountEl.textContent = "0";
    receivedCountEl.textContent = "0";
    fallbackChainEl.textContent = "-";
    
    updateStatus(false);
    logMessage("info", "Disconnected");
  }
}

// Send message
function sendMessage(message: string, data?: Record<string, unknown>) {
  if (!transport) return;
  
  try {
    const envelope = {
      messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      clientId: "getClientId" in transport ? (transport as { getClientId: () => string }).getClientId() : "unknown",
      topic: "demo.message",
      payload: { message, ...data },
      timestamp: Date.now(),
      version: 1,
      origin: window.location.origin,
    };
    
    transport.send(envelope);
    
    sentCount++;
    sentCountEl.textContent = sentCount.toString();
    
    logMessage("sent", message, { messageId: envelope.messageId });
  } catch (error) {
    logMessage("error", `Send failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Event listeners
connectBtn.addEventListener("click", connect);
disconnectBtn.addEventListener("click", disconnect);

sendBtn.addEventListener("click", () => {
  const message = messageInput.value.trim();
  if (message) {
    sendMessage(message);
    messageInput.value = "";
  }
});

messageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    sendBtn.click();
  }
});

clearLogBtn.addEventListener("click", () => {
  messageLog.innerHTML = "";
  logMessage("info", "Log cleared");
});

// Quick action buttons
document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!transport) return;
    
    const action = btn.getAttribute("data-action");
    
    switch (action) {
      case "broadcast":
        sendMessage("📢 Broadcast test message!");
        break;
        
      case "spam":
        for (let i = 1; i <= 10; i++) {
          setTimeout(() => {
            sendMessage(`Message ${i}/10`);
          }, i * 100);
        }
        break;
        
      case "large":
        const largeData = {
          message: "Large payload test",
          data: Array.from({ length: 100 }, (_, i) => ({
            id: i,
            value: `Item ${i}`,
            timestamp: Date.now(),
          })),
        };
        sendMessage("📦 Large payload", largeData);
        break;
        
      case "stress":
        logMessage("info", "Starting stress test: 100 messages");
        for (let i = 1; i <= 100; i++) {
          setTimeout(() => {
            sendMessage(`Stress test ${i}/100`);
            if (i === 100) {
              logMessage("info", "Stress test complete!");
            }
          }, i * 50);
        }
        break;
    }
  });
});

// Initial log
logMessage("info", "Transport Demo Ready! Select a transport and click Connect.");
