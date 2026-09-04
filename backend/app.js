import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import { createApiRouter } from "./routes/api.js";
import { createMobileUploadRouter } from "./routes/mobile_upload.js";
import { createScoutRouter } from "./routes/scout.js";
import { attachVoiceStreamServer } from "./voice_stream.js";
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
  app.disable("x-powered-by");
  app.locals.db = db;
  app.locals.events = events;
  app.locals.orchestrator = orchestrator;
  setTimeout(() => orchestrator.recoverInterruptedSessions(), 100);
  const runtimeEnv = options.env ?? process.env;
  if (runtimeEnv.SYNOD_ACCESS_PASSWORD) {
    const expectedUser = runtimeEnv.SYNOD_ACCESS_USERNAME || "synod";
    const expectedPassword = runtimeEnv.SYNOD_ACCESS_PASSWORD;
    app.use((req, res, next) => {
      if (req.path === "/api/v1/health") return next();
      const [scheme, encoded] = String(req.headers.authorization || "").split(" ");
      let username = "";
      let password = "";
      if (/^basic$/i.test(scheme) && encoded) {
        try {
          const decoded = Buffer.from(encoded, "base64").toString("utf8");
          const separator = decoded.indexOf(":");
          username = separator >= 0 ? decoded.slice(0, separator) : decoded;
          password = separator >= 0 ? decoded.slice(separator + 1) : "";
        } catch {}
      }
      if (safeEqual(username, expectedUser) && safeEqual(password, expectedPassword)) return next();
      res.setHeader("WWW-Authenticate", 'Basic realm="Synod", charset="UTF-8"');
      return res.status(401).send("Authentication required");
    });
  }
  const allowedOrigins = String(options.env?.CORS_ORIGIN ?? process.env.CORS_ORIGIN ?? "")
    .split(",").map((origin) => origin.trim()).filter(Boolean);
  if (allowedOrigins.length) {
    app.use(cors({ origin: allowedOrigins, methods: ["GET", "POST", "OPTIONS"] }));
  }
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "microphone=(self), camera=(), geolocation=(), payment=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    next();
  });
  app.use(express.json({ limit: "24mb" }));
  app.use("/api/v1", createApiRouter({ db, events, orchestrator }));
  app.use("/api/v1/mobile", createMobileUploadRouter({ db, events, env: runtimeEnv }));
  app.use("/api/v1/scout", createScoutRouter());
  app.use("/uploads", express.static(path.join(root, "data/uploads")));
  app.get("/", (_req, res) => res.sendFile(path.join(root, "frontend", "about.html")));
  app.get("/app", (_req, res) => res.sendFile(path.join(root, "frontend", "index.html")));
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

function safeEqual(actual, expected) {
  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);
  const tlsEnabled = Boolean(process.env.SYNOD_TLS_CERT_PATH && process.env.SYNOD_TLS_KEY_PATH);
  const server = tlsEnabled
    ? https.createServer({ cert: fs.readFileSync(process.env.SYNOD_TLS_CERT_PATH), key: fs.readFileSync(process.env.SYNOD_TLS_KEY_PATH) }, app).listen(port, "0.0.0.0", announce)
    : app.listen(port, "0.0.0.0", announce);
  attachVoiceStreamServer(server, { env: process.env, root });
  function announce() { console.log(`Synod is running at http${tlsEnabled ? "s" : ""}://localhost:${server.address().port} (bound to 0.0.0.0)`); }
  server.on('error', (e) => console.error("Server error:", e));
  
  // Prevent silent kills — log and clean up gracefully
  process.on('SIGTERM', () => { console.log('[Synod] SIGTERM received — shutting down'); server.close(() => process.exit(0)); });
  process.on('SIGINT',  () => { console.log('[Synod] SIGINT received — shutting down');  server.close(() => process.exit(0)); });
  process.on('uncaughtException', (err) => { console.error('[Synod] uncaughtException:', err.message, err.stack); process.exit(1); });
  process.on('unhandledRejection', (reason) => { console.error('[Synod] unhandledRejection:', reason); });
}
