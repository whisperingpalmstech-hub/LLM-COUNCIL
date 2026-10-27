import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** HTTP Basic auth check shared by REST routes and the WebSocket upgrade. */
export function isAuthorized(req: IncomingMessage, auth: { username: string; password: string } | null): boolean {
  if (!auth) return true;
  const [scheme, encoded] = String(req.headers.authorization ?? "").split(" ");
  if (!/^basic$/i.test(scheme ?? "") || !encoded) return false;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  return safeEqual(decoded.slice(0, sep), auth.username) && safeEqual(decoded.slice(sep + 1), auth.password);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
