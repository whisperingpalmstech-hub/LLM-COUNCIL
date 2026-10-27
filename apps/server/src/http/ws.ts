import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { AuthUser, ServerPush } from "@synod/contracts";
import type { Accounts } from "../auth/accounts.ts";
import type { EventStore } from "../events/store.ts";
import { sessionUser } from "./session.ts";

/**
 * Push channel. Every appended event (and every streaming draft) goes to each
 * connected browser whose signed-in user owns that conversation. Clients load a
 * snapshot over REST and fold pushed events into it; on reconnect they refetch.
 */
export function attachWebSocket(server: Server, store: EventStore, accounts: Accounts): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const users = new WeakMap<WebSocket, AuthUser>();

  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://x").pathname !== "/ws") return socket.destroy();
    const user = sessionUser(req, accounts);
    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      users.set(ws, user);
      wss.emit("connection", ws, req);
    });
  });

  const canSee = (user: AuthUser, conversationId: string) => {
    const c = store.get(conversationId);
    return Boolean(c && (c.ownerId ? c.ownerId === user.id : user.role === "admin"));
  };
  const broadcast = (conversationId: string, push: ServerPush) => {
    const message = JSON.stringify(push);
    for (const client of wss.clients) {
      const user = users.get(client);
      if (client.readyState === client.OPEN && user && canSee(user, conversationId)) client.send(message);
    }
  };

  const unsubscribe = store.subscribe((event) => broadcast(event.conversationId, { type: "event", event }));
  const unsubscribeDrafts = store.subscribeDrafts((draft) => broadcast(draft.conversationId, draft));
  wss.on("close", () => {
    unsubscribe();
    unsubscribeDrafts();
  });

  // Keep proxies from dropping idle connections.
  const ping = setInterval(() => wss.clients.forEach((c) => c.ping()), 30_000);
  ping.unref();
  return wss;
}
