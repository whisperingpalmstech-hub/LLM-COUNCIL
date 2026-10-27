import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Accounts } from "./auth/accounts.ts";
import { loadConfig, type Config } from "./config.ts";
import { CouncilEngine } from "./council/engine.ts";
import { openDatabase, Settings } from "./db/database.ts";
import { EventStore } from "./events/store.ts";
import { createApp } from "./http/app.ts";
import { attachWebSocket } from "./http/ws.ts";
import { WebSearch } from "./integrations/search.ts";
import { Transcriber } from "./integrations/transcription.ts";
import { ProviderRegistry } from "./providers/registry.ts";

/** Wire every component together. Exported so tests can build an in-process server. */
export function createServer(config: Config) {
  const db = openDatabase(config.databasePath);
  const store = new EventStore(db);
  const providers = ProviderRegistry.fromConfig(config);
  const search = new WebSearch(config.env);
  const settings = new Settings(db);
  const accounts = new Accounts(db);
  const engine = new CouncilEngine({ store, providers, settings, search, obsidianVaultPath: config.obsidianVaultPath, uploadsDir: path.join(config.dataDir, "uploads"), env: config.env });
  // A stable secret for signed upload links: from env, else generated once and kept in the database.
  let secret = config.secret ?? settings.get<string>("secret");
  if (!secret) {
    secret = crypto.randomBytes(32).toString("base64url");
    settings.set("secret", secret);
  }
  const app = createApp({ config, store, engine, providers, search, transcriber: new Transcriber(config.env), accounts, secret });
  const server = config.tls
    ? https.createServer({ cert: fs.readFileSync(config.tls.certPath), key: fs.readFileSync(config.tls.keyPath) }, app)
    : http.createServer(app);
  attachWebSocket(server, store, accounts);
  return { server, app, db, store, engine, providers, accounts };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const { server, engine, providers, db, accounts } = createServer(config);
  if (config.bootstrapAdmin && accounts.count() === 0) {
    await accounts.create({ ...config.bootstrapAdmin, role: "admin" });
    console.log(`[synod] created admin account ${config.bootstrapAdmin.email}`);
  }
  const recovered = engine.recoverInterrupted();
  if (recovered) console.log(`[synod] closed ${recovered} turn(s) interrupted by the last shutdown`);
  server.listen(config.port, config.host, () => {
    const live = providers.status().filter((p) => p.configured && p.provider !== "mock").map((p) => p.provider);
    console.log(`[synod] listening on ${config.tls ? "https" : "http"}://localhost:${config.port}`);
    console.log(`[synod] providers: ${live.length ? live.join(", ") : "none configured — using mock council"}`);
    if (accounts.count() === 0) console.log("[synod] no accounts yet: the first person to sign up becomes the administrator");
  });
  const shutdown = () => {
    server.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
