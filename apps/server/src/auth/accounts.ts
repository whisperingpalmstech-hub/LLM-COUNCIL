import crypto from "node:crypto";
import { promisify } from "node:util";
import type { DatabaseSync } from "node:sqlite";
import { PROFESSIONS, type AuthUser, type UserProfile } from "@synod/contracts";

const scrypt = promisify(crypto.scrypt) as (password: string, salt: Buffer, keylen: number, options: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_DAYS = 30;

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: string;
  profile: string | null;
  google_sub: string | null;
}

/** Users, password hashing (scrypt), and opaque session tokens (only their SHA-256 is stored). */
export class Accounts {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  count(): number {
    return Number((this.db.prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n);
  }

  async create(input: { email: string; name: string; password: string; role?: "admin" | "member" }): Promise<AuthUser> {
    const email = normalizeEmail(input.email);
    const name = input.name.trim().slice(0, 80) || email.split("@")[0];
    validatePassword(input.password);
    if (this.db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw new AuthError("An account with this email already exists. Sign in instead.", 409);
    const user: AuthUser = { id: crypto.randomUUID(), email, name, role: input.role ?? "member", profile: null };
    this.db
      .prepare("INSERT INTO users(id, email, name, password_hash, role, created_at) VALUES(?, ?, ?, ?, ?, ?)")
      .run(user.id, email, name, await hashPassword(input.password), user.role, new Date().toISOString());
    return user;
  }

  async verify(emailInput: string, password: string): Promise<AuthUser> {
    const row = this.db.prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(emailInput)) as UserRow | undefined;
    // Hash even when the user doesn't exist (or has no password) so timing doesn't reveal which emails are registered.
    const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) throw new AuthError("That email and password don't match. Check them and try again.", 401);
    return toUser(row);
  }

  /** Sign in with Google: match by Google id, then by verified email (linking it); otherwise create when allowed. */
  googleUser(input: { sub: string; email: string; name: string }, canCreate: () => "admin" | "member" | null): AuthUser {
    const bySub = this.db.prepare("SELECT * FROM users WHERE google_sub = ?").get(input.sub) as UserRow | undefined;
    if (bySub) return toUser(bySub);
    const email = normalizeEmail(input.email);
    const byEmail = this.db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
    if (byEmail) {
      this.db.prepare("UPDATE users SET google_sub = ? WHERE id = ?").run(input.sub, byEmail.id);
      return toUser(byEmail);
    }
    const role = canCreate();
    if (!role) throw new AuthError("There's no Synod account for this Google address. Ask for an invite, then sign up.", 403);
    const id = crypto.randomUUID();
    const name = input.name.trim().slice(0, 80) || email.split("@")[0];
    // Google-only accounts have no password; password sign-in can't match an empty hash.
    this.db
      .prepare("INSERT INTO users(id, email, name, password_hash, role, created_at, google_sub) VALUES(?, ?, ?, '', ?, ?, ?)")
      .run(id, email, name, role, new Date().toISOString(), input.sub);
    return { id, email, name, role, profile: null };
  }

  setProfile(userId: string, input: unknown): AuthUser {
    const profile = validateProfile(input);
    this.db.prepare("UPDATE users SET profile = ? WHERE id = ?").run(JSON.stringify(profile), userId);
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as UserRow;
    return toUser(row);
  }

  createSession(userId: string): { token: string; expires: Date } {
    const token = crypto.randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    this.db.prepare("INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES(?, ?, ?, ?)").run(sha256(token), userId, new Date().toISOString(), expires.toISOString());
    return { token, expires };
  }

  userForSession(token: string | undefined): AuthUser | null {
    if (!token) return null;
    const row = this.db
      .prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?")
      .get(sha256(token), new Date().toISOString()) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  deleteSession(token: string | undefined): void {
    if (token) this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  }
}

function toUser(row: UserRow): AuthUser {
  let profile: UserProfile | null = null;
  try {
    profile = row.profile ? (JSON.parse(row.profile) as UserProfile) : null;
  } catch {
    profile = null;
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role === "admin" ? "admin" : "member", profile };
}

function validateProfile(input: unknown): UserProfile {
  const p = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const profession = PROFESSIONS.includes(p.profession as UserProfile["profession"]) ? (p.profession as UserProfile["profession"]) : null;
  const country = text(p.country, 80);
  if (!profession) throw new AuthError("Choose what best describes your work.", 400);
  if (!country) throw new AuthError("Tell us where you practise, so advice follows the right rules.", 400);
  return {
    profession,
    specialty: text(p.specialty, 120),
    country,
    ...(text(p.region, 80) ? { region: text(p.region, 80) } : {}),
    ...(text(p.setting, 120) ? { setting: text(p.setting, 120) } : {}),
    answerStyle: p.answerStyle === "concise" ? "concise" : "detailed"
  };
}

function normalizeEmail(email: string): string {
  const e = String(email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 200) throw new AuthError("Enter a valid email address.", 400);
  return e;
}

function validatePassword(password: string): void {
  if (typeof password !== "string" || password.length < 10) throw new AuthError("Use a password of at least 10 characters.", 400);
  if (password.length > 200) throw new AuthError("That password is too long.", 400);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(String(password ?? ""), Buffer.from(saltB64, "base64"), expected.length, { ...SCRYPT, N: Number(n) });
  return crypto.timingSafeEqual(actual, expected);
}

const DUMMY_HASH = `scrypt$16384$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(32).toString("base64")}`;

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Short-lived signed link letting a phone add files to one conversation without signing in. */
export function signUploadToken(secret: string, conversationId: string, ttlMs = 12 * 3_600_000): string {
  const exp = Date.now() + ttlMs;
  const sig = crypto.createHmac("sha256", secret).update(`${conversationId}.${exp}`).digest("base64url");
  return `${exp}.${sig}`;
}

export function verifyUploadToken(secret: string, conversationId: string, token: string | undefined): boolean {
  const [expRaw, sig] = String(token ?? "").split(".");
  const exp = Number(expRaw);
  if (!sig || !Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${conversationId}.${exp}`).digest("base64url");
  return expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

/** A read-only link to one turn's document: ids + expiry, HMAC-signed. Revocation is checked separately. */
export function signShareToken(secret: string, payload: { c: string; t: string; s: string; e: number }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", `share:${secret}`).update(body).digest("base64url")}`;
}

export function readShareToken(secret: string, token: string): { c: string; t: string; s: string; e: number } | null {
  const [body, sig] = String(token).split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", `share:${secret}`).update(body).digest("base64url");
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { c: string; t: string; s: string; e: number };
    return p.e > Date.now() ? p : null;
  } catch {
    return null;
  }
}

/** Fixed-window limiter for sign-in attempts. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; reset: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }
  check(key: string): void {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.reset < now) {
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      return;
    }
    if (++entry.count > this.limit) throw new AuthError("Too many attempts. Wait a few minutes and try again.", 429);
  }
}
