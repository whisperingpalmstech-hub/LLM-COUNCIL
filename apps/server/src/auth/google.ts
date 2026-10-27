import crypto from "node:crypto";
import { AuthError } from "./accounts.ts";

/**
 * "Continue with Google" via the OAuth 2.0 authorization-code flow (server side, with the client secret).
 * The `state` parameter is HMAC-signed and bound to the browser by a short-lived cookie (login CSRF).
 */
export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

interface StatePayload {
  nonce: string;
  invite?: string;
  next?: string;
  exp: number;
}

export const OAUTH_COOKIE = "synod_oauth";

export function googleAuthUrl(config: GoogleConfig, redirectUri: string, secret: string, payload: Omit<StatePayload, "exp" | "nonce">): { url: string; nonce: string } {
  const nonce = crypto.randomBytes(16).toString("base64url");
  const state = sign(secret, { ...payload, nonce, exp: Date.now() + 10 * 60_000 });
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account"
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, nonce };
}

export function readState(secret: string, state: string, cookieNonce: string | undefined): StatePayload {
  const payload = verify(secret, state);
  if (!payload || payload.exp < Date.now()) throw new AuthError("Google sign-in took too long. Please try again.", 400);
  if (!cookieNonce || cookieNonce !== payload.nonce) throw new AuthError("Google sign-in couldn't be verified in this browser. Please try again.", 400);
  return payload;
}

export async function googleProfile(config: GoogleConfig, redirectUri: string, code: string): Promise<{ sub: string; email: string; name: string }> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!tokenRes.ok) throw new AuthError("Google didn't accept the sign-in. Please try again.", 502);
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(15_000) });
  if (!infoRes.ok) throw new AuthError("Couldn't read your Google profile. Please try again.", 502);
  const info = (await infoRes.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string };
  if (!info.sub || !info.email) throw new AuthError("Google didn't share an email address.", 400);
  if (info.email_verified !== true) throw new AuthError("Verify your Google email address first, then try again.", 403);
  return { sub: info.sub, email: info.email, name: info.name ?? "" };
}

function sign(secret: string, payload: StatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
}

function verify(secret: string, token: string): StatePayload | null {
  const [body, sig] = String(token).split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as StatePayload;
  } catch {
    return null;
  }
}
