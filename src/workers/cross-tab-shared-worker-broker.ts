const clients = new Map();
const channels = new Map();

// @ts-expect-error @typescript-eslint/ban-ts-comment
self.onconnect = function (event: any) {
  const port = event.ports[0];
  let clientId: string | null = null;
  let channelName: string | null = null;

  port.onmessage = function (e: any) {
    const message = e.data;

    switch (message.type) {
      case "register": {
        clientId = message.clientId || crypto.randomUUID();
        channelName = message.channelName || "default";

        // Store port reference
        clients.set(clientId, port);

        // Add to channel
        if (!channels.has(channelName)) {
          channels.set(channelName, new Set());
        }
        channels.get(channelName).add(clientId);

        // Send registration confirmation
        port.postMessage({
          type: "registered",
          clientId: clientId,
          timestamp: Date.now(),
        });

        console.log(
          "[SharedWorker Broker] Client registered:",
          clientId,
          "Channel:",
          channelName,
          "Total clients:",
          clients.size
        );
        break;
      }

      case "publish": {
        if (!clientId || !channelName) {
          port.postMessage({ type: "error", error: "Not registered" });
          return;
        }

        const channelClients = channels.get(channelName);
        if (channelClients) {
          let deliveredCount = 0;

          for (const targetClientId of channelClients) {
            // Don't send to self
            if (targetClientId === clientId) continue;

            const targetPort = clients.get(targetClientId);
            if (targetPort) {
              try {
                targetPort.postMessage({
                  type: "deliver",
                  payload: message.payload,
                  timestamp: Date.now(),
                });
                deliveredCount++;
              } catch (err) {
                console.error("[SharedWorker Broker] Failed to deliver to", targetClientId, err);
                clients.delete(targetClientId);
                channelClients.delete(targetClientId);
              }
            }
          }

          console.log(
            "[SharedWorker Broker] Published message from",
            clientId,
            "to",
            deliveredCount,
            "clients"
          );
        }
        break;
      }

      case "disconnect": {
        cleanup();
        break;
      }

      case "ping": {
        port.postMessage({ type: "pong", timestamp: Date.now() });
        break;
      }
    }
  };

  function cleanup() {
    if (clientId) {
      clients.delete(clientId);
      if (channelName && channels.has(channelName)) {
        channels.get(channelName).delete(clientId);
        if (channels.get(channelName).size === 0) {
          channels.delete(channelName);
        }
      }
      console.log(
        "[SharedWorker Broker] Client disconnected:",
        clientId,
        "Remaining clients:",
        clients.size
      );
    }
  }

  port.start();
};

// Make TypeScript happy - this file will be compiled but used as a worker
export {};
