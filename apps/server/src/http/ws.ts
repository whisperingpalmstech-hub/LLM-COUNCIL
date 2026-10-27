import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { ServerPush } from "@synod/contracts";
import type { Config } from "../config.ts";
import type { EventStore } from "../events/store.ts";
import { isAuthorized } from "./auth.ts";

/**
 * Push channel: every appended event is broadcast to every connected browser.
 * Clients load a conversation snapshot over REST, then fold pushed events into it.
 * On reconnect they refetch, so no replay protocol is needed.
 */
export function attachWebSocket(server: Server, store: EventStore, config: Config): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://x").pathname !== "/ws") return socket.destroy();
    if (!isAuthorized(req, config.auth)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket) => {
    send(ws, { type: "hello", latestSeq: store.latestSeq() });
  });

  const unsubscribe = store.subscribe((event) => {
    const message = JSON.stringify({ type: "event", event } satisfies ServerPush);
    for (const client of wss.clients) if (client.readyState === client.OPEN) client.send(message);
  });
  wss.on("close", unsubscribe);

  // Keep proxies from dropping idle connections.
  const ping = setInterval(() => wss.clients.forEach((c) => c.ping()), 30_000);
  ping.unref();
  return wss;
}

function send(ws: WebSocket, message: ServerPush): void {
  ws.send(JSON.stringify(message));
}
