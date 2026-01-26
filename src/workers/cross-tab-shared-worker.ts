const clients = new Map();
const channels = new Map();

// @ts-expect-error @typescript-eslint/ban-ts-comment
self.onconnect = function (event: MessageEvent) {
  const port = event.ports[0];
  let clientId = "";
  let channelName = "";

  port.onmessage = function (e) {
    const message = e.data;

    switch (message.type) {
      case "register": {
        clientId = message.clientId || crypto.randomUUID();
        channelName = message.channelName || "default";

        clients.set(clientId, port);

        if (!channels.has(channelName)) {
          channels.set(channelName, new Set());
        }

        channels.get(channelName).add(clientId);
        port.postMessage({ type: "registered", clientId, timestamp: Date.now() });
        break;
      }
      case "publish": {
        if (!clientId || !channelName) {
          port.postMessage({ type: "error", error: "Not registered" });
          return;
        }

        const channelClients = channels.get(channelName);

        if (channelClients) {
          for (const targetClientId of channelClients) {
            if (targetClientId !== clientId) {
              const targetPort = clients.get(targetClientId);

              if (targetPort) {
                try {
                  targetPort.postMessage({
                    type: "deliver",
                    payload: message.payload,
                    timestamp: Date.now(),
                  });
                } catch (_err) {
                  clients.delete(targetClientId);
                  channelClients.delete(targetClientId);
                }
              }
            }
          }
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
    }
  }

  port.start();
};
