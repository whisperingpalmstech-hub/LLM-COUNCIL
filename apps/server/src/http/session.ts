import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthUser } from "@synod/contracts";
import type { Accounts } from "../auth/accounts.ts";

export const SESSION_COOKIE = "synod_session";

export function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function sessionUser(req: IncomingMessage, accounts: Accounts): AuthUser | null {
  return accounts.userForSession(readCookie(req, SESSION_COOKIE));
}

/** HttpOnly, SameSite=Lax; Secure whenever the request arrived over HTTPS (directly or via a proxy like ngrok). */
export function setSessionCookie(req: IncomingMessage, res: ServerResponse, token: string, expires: Date): void {
  const secure = isHttps(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure}`);
}

export function clearSessionCookie(req: IncomingMessage, res: ServerResponse): void {
  const secure = isHttps(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function isHttps(req: IncomingMessage): boolean {
  return Boolean((req.socket as { encrypted?: boolean }).encrypted) || String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() === "https";
}
