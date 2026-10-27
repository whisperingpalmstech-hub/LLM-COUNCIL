import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { fileURLToPath } from "node:url";
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
  const engine = new CouncilEngine({ store, providers, settings: new Settings(db), search, obsidianVaultPath: config.obsidianVaultPath, env: config.env });
  const app = createApp({ config, store, engine, providers, search, transcriber: new Transcriber(config.env) });
  const server = config.tls
    ? https.createServer({ cert: fs.readFileSync(config.tls.certPath), key: fs.readFileSync(config.tls.keyPath) }, app)
    : http.createServer(app);
  attachWebSocket(server, store, config);
  return { server, app, db, store, engine, providers };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const { server, engine, providers, db } = createServer(config);
  const recovered = engine.recoverInterrupted();
  if (recovered) console.log(`[synod] closed ${recovered} turn(s) interrupted by the last shutdown`);
  server.listen(config.port, config.host, () => {
    const live = providers.status().filter((p) => p.configured && p.provider !== "mock").map((p) => p.provider);
    console.log(`[synod] listening on ${config.tls ? "https" : "http"}://localhost:${config.port}`);
    console.log(`[synod] providers: ${live.length ? live.join(", ") : "none configured — using mock council"}`);
    if (!config.auth && config.host === "0.0.0.0") console.warn("[synod] no SYNOD_ACCESS_PASSWORD set; anyone on your network can reach this server");
  });
  const shutdown = () => {
    server.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
