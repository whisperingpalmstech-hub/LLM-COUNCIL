import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { createApiRouter } from "./routes/api.js";
import { createMobileUploadRouter } from "./routes/mobile_upload.js";
import { createScoutRouter } from "./routes/scout.js";
import { openDatabase, migrate } from "./db/sqlite.js";
import { CouncilOrchestrator } from "./core/orchestrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

export async function createApp(options = {}) {
  const db = options.db ?? openDatabase(process.env.DATABASE_URL ?? "./data/synod.sqlite");
  migrate(db);
  const events = options.events ?? new EventEmitter();
  events.setMaxListeners(200);
  const orchestrator = new CouncilOrchestrator({ db, events, env: options.env ?? process.env });
  const app = express();
  app.locals.db = db;
  app.locals.events = events;
  app.locals.orchestrator = orchestrator;
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/v1", createApiRouter({ db, events, orchestrator }));
  app.use("/api/v1/mobile", createMobileUploadRouter({ db, events }));
  app.use("/api/v1/scout", createScoutRouter());
  app.use("/uploads", express.static(path.join(root, "data/uploads")));
  app.use(express.static(path.join(root, "frontend"), {
    setHeaders: (res, path) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  }));

  app.get("*", (_req, res) => res.sendFile(path.join(root, "frontend", "index.html")));
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Synod is running at http://localhost:${server.address().port} (bound to 0.0.0.0)`);
  });
  server.on('error', (e) => console.error("Server error:", e));
  
  // Prevent silent kills — log and clean up gracefully
  process.on('SIGTERM', () => { console.log('[Synod] SIGTERM received — shutting down'); server.close(() => process.exit(0)); });
  process.on('SIGINT',  () => { console.log('[Synod] SIGINT received — shutting down');  server.close(() => process.exit(0)); });
  process.on('uncaughtException', (err) => { console.error('[Synod] uncaughtException:', err.message, err.stack); process.exit(1); });
  process.on('unhandledRejection', (reason) => { console.error('[Synod] unhandledRejection:', reason); });
}
