import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export type Env = Record<string, string | undefined>;

export interface Config {
  port: number;
  host: string;
  databasePath: string;
  dataDir: string;
  webDistDir: string;
  publicBaseUrl: string | null;
  auth: { username: string; password: string } | null;
  tls: { certPath: string; keyPath: string } | null;
  requestTimeoutMs: number;
  maxRetries: number;
  obsidianVaultPath: string | null;
  hermes: { url: string; apiKey: string | null } | null;
  env: Env;
}

export function loadConfig(env: Env = process.env): Config {
  const dataDir = resolve(env.SYNOD_DATA_DIR || "./data");
  return {
    port: int(env.PORT, 3000),
    host: env.HOST || "0.0.0.0",
    databasePath: env.DATABASE_PATH === ":memory:" ? ":memory:" : resolve(env.DATABASE_PATH || path.join(dataDir, "synod.sqlite")),
    dataDir,
    webDistDir: resolve(env.WEB_DIST_DIR || "./apps/web/dist"),
    publicBaseUrl: trimSlash(env.PUBLIC_BASE_URL) || null,
    auth: env.SYNOD_ACCESS_PASSWORD ? { username: env.SYNOD_ACCESS_USERNAME || "synod", password: env.SYNOD_ACCESS_PASSWORD } : null,
    tls: env.SYNOD_TLS_CERT_PATH && env.SYNOD_TLS_KEY_PATH ? { certPath: env.SYNOD_TLS_CERT_PATH, keyPath: env.SYNOD_TLS_KEY_PATH } : null,
    requestTimeoutMs: int(env.PROVIDER_REQUEST_TIMEOUT_MS, 120_000),
    maxRetries: int(env.PROVIDER_MAX_RETRIES, 1),
    obsidianVaultPath: env.OBSIDIAN_VAULT_PATH ? resolve(env.OBSIDIAN_VAULT_PATH) : null,
    hermes: env.HERMES_WEBHOOK_URL ? { url: env.HERMES_WEBHOOK_URL, apiKey: env.HERMES_API_KEY || null } : null,
    env
  };
}

function resolve(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(ROOT, p);
}

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function trimSlash(value: string | undefined): string {
  return String(value || "").trim().replace(/\/+$/, "");
}
