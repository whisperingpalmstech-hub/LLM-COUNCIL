import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { createApiRouter } from "./routes/api.js";
import { openDatabase, migrate } from "./db/sqlite.js";
import { CouncilOrchestrator } from "./core/orchestrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

export async function createApp(options = {}) {
  const db = options.db ?? openDatabase(process.env.DATABASE_URL ?? "./data/synod.sqlite");
  migrate(db);
  const events = options.events ?? new EventEmitter();
  events.setMaxListeners(200);
  const orchestrator = new CouncilOrchestrator({ db, events });
  const app = express();
  app.locals.db = db;
  app.locals.events = events;
  app.locals.orchestrator = orchestrator;
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/v1", createApiRouter({ db, events, orchestrator }));
  app.use(express.static(path.join(root, "frontend")));
  app.get("*", (_req, res) => res.sendFile(path.join(root, "frontend", "index.html")));
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => {
    console.log(`Synod is running at http://localhost:${port}`);
  });
}
