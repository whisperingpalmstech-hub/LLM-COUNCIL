import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

export function id() {
  return crypto.randomUUID();
}

export function now() {
  return new Date().toISOString();
}

export function openDatabase(location = "./data/synod.sqlite") {
  const filename = location === ":memory:" ? location : path.resolve(root, location);
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export function migrate(db) {
  const migrationsDir = path.join(root, "migrations");
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    try {
      db.exec(sql);
    } catch (e) {
      if (!e.message.includes("duplicate column name")) {
        throw e;
      }
    }
  }
  seedDefaults(db);
}

export function seedDefaults(db) {
  const existing = db.prepare("select count(*) as count from models").get().count;
  if (!existing) {
    const insertModel = db.prepare("insert into models(id, provider, model_name, display_name, supports_web, supports_rag, reasoning_score, cost_per_1k, active) values(?,?,?,?,?,?,?,?,1)");
    insertModel.run(id(), "mock", "mock-fast", "Mock Fast", 1, 1, 6, 0);
    insertModel.run(id(), "mock", "mock-deep", "Mock Deep Reasoner", 1, 1, 9, 0);
    insertModel.run(id(), "openai", process.env.OPENAI_MODEL || "gpt-4.1-mini", "OpenAI", 1, 1, 8, 0.01);
    insertModel.run(id(), "anthropic", process.env.ANTHROPIC_MODEL || "claude-sonnet-4", "Anthropic Claude", 0, 1, 9, 0.015);
    insertModel.run(id(), "gemini", process.env.GEMINI_MODEL || "gemini-2.5-flash", "Google Gemini", 1, 1, 7, 0.005);
    insertModel.run(id(), "anythingllm", "anythingllm", "AnythingLLM Workspace Model", 1, 1, 8, 0);
  }
  const workspaces = db.prepare("select count(*) as count from workspaces").get().count;
  if (!workspaces) {
    const insertWorkspace = db.prepare("insert into workspaces(id, external_id, name, description, tags, health_status) values(?,?,?,?,?,?)");
    insertWorkspace.run(id(), "architecture", "Architecture Knowledge", "Deployment, reliability, and infrastructure references.", JSON.stringify(["architecture", "cloud"]), "healthy");
    insertWorkspace.run(id(), "policy", "Policy Knowledge", "Governance, privacy, and compliance references.", JSON.stringify(["policy", "risk"]), "healthy");
    insertWorkspace.run(id(), "product", "Product Strategy", "Launch, adoption, pricing, and user impact references.", JSON.stringify(["product", "strategy"]), "healthy");
  }
}

if (process.argv[2] === "migrate") {
  const db = openDatabase(process.env.DATABASE_URL ?? "./data/synod.sqlite");
  migrate(db);
  console.log("SQLite migration complete.");
}
