import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import type {
  AnswerClarificationRequest,
  AuthConfigResponse,
  AuthUser,
  Conversation,
  LoginRequest,
  SignupRequest,
  CaseMode,
  CouncilConfig,
  CreateConversationRequest,
  SendMessageRequest,
  ServerInfo,
  UploadAttachmentRequest
} from "@synod/contracts";
import type { Config } from "../config.ts";
import type { CouncilEngine } from "../council/engine.ts";
import { briefMarkdown } from "../council/brief.ts";
import type { EventStore } from "../events/store.ts";
import { saveAttachment } from "../integrations/attachments.ts";
import { handOffToHermes } from "../integrations/hermes.ts";
import type { WebSearch } from "../integrations/search.ts";
import { MAX_AUDIO_BYTES, type Transcriber } from "../integrations/transcription.ts";
import type { ProviderRegistry } from "../providers/registry.ts";
import { AuthError, RateLimiter, signUploadToken, verifyUploadToken, type Accounts } from "../auth/accounts.ts";
import { clearSessionCookie, readCookie, SESSION_COOKIE, sessionUser, setSessionCookie } from "./session.ts";

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

export interface AppDeps {
  config: Config;
  store: EventStore;
  engine: CouncilEngine;
  providers: ProviderRegistry;
  search: WebSearch;
  transcriber: Transcriber;
  accounts: Accounts;
  secret: string;
}

export function createApp({ config, store, engine, providers, search, transcriber, accounts, secret }: AppDeps): express.Express {
  const loginLimiter = new RateLimiter(10, 15 * 60_000);
  const signupLimiter = new RateLimiter(5, 60 * 60_000);

  /** Cases are private to their owner; cases from before accounts existed belong to admins. */
  const canAccess = (c: Conversation, user: AuthUser) => (c.ownerId ? c.ownerId === user.id : user.role === "admin");
  const owned = (id: string, user: AuthUser | undefined): Conversation => {
    const c = store.require(id);
    if (!user || !canAccess(c, user)) throw Object.assign(new Error("Conversation not found."), { status: 404 });
    return c;
  };
  const signupMode = (): AuthConfigResponse["signup"] => (accounts.count() === 0 ? "first-user" : config.signup.mode);
  const app = express();
  const uploadsDir = path.join(config.dataDir, "uploads");
  app.disable("x-powered-by");
  // Behind a local reverse proxy (ngrok, Caddy) so req.ip and rate limits see the real client.
  app.set("trust proxy", "loopback");

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "microphone=(self), camera=(self), geolocation=()");
    next();
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  const api = express.Router();
  api.use(express.json({ limit: "15mb" }));
  api.use((req, _res, next) => {
    req.user = sessionUser(req, accounts) ?? undefined;
    next();
  });

  // ---- public: sign-in ----
  api.get("/auth/config", (_req, res) => res.json({ signup: signupMode() } satisfies AuthConfigResponse));
  api.get("/auth/me", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Not signed in." });
    res.json({ user: req.user });
  });
  api.post("/auth/login", async (req, res) => {
    const body = req.body as LoginRequest;
    loginLimiter.check(`${req.ip}:${String(body?.email ?? "").toLowerCase()}`);
    const user = await accounts.verify(String(body?.email ?? ""), String(body?.password ?? ""));
    const session = accounts.createSession(user.id);
    setSessionCookie(req, res, session.token, session.expires);
    res.json({ user });
  });
  api.post("/auth/signup", async (req, res) => {
    signupLimiter.check(String(req.ip));
    const body = req.body as SignupRequest;
    const mode = signupMode();
    if (mode === "closed") throw new AuthError("Sign-ups are closed. Ask the administrator for an account.", 403);
    if (mode === "invite" && String(body?.inviteCode ?? "").trim() !== config.signup.inviteCode) throw new AuthError("That invite code isn't valid.", 403);
    const user = await accounts.create({ email: String(body?.email ?? ""), name: String(body?.name ?? ""), password: String(body?.password ?? ""), role: mode === "first-user" ? "admin" : "member" });
    const session = accounts.createSession(user.id);
    setSessionCookie(req, res, session.token, session.expires);
    res.status(201).json({ user });
  });
  api.post("/auth/logout", (req, res) => {
    accounts.deleteSession(readCookie(req, SESSION_COOKIE));
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // ---- public with a signed link: phone uploads into one case ----
  api.post("/conversations/:id/attachments", async (req, res) => {
    const conversation = req.user ? owned(req.params.id, req.user) : store.require(req.params.id);
    if (!req.user && !verifyUploadToken(secret, conversation.id, String(req.query.token ?? ""))) {
      throw Object.assign(new Error("This upload link has expired. Scan the QR code again."), { status: 401 });
    }
    const body = req.body as UploadAttachmentRequest;
    if (!body?.data) throw Object.assign(new Error("File data is required."), { status: 400 });
    const attachment = await saveAttachment(uploadsDir, {
      name: String(body.name ?? "upload"),
      mimeType: String(body.mimeType ?? ""),
      data: String(body.data),
      source: body.source === "mobile" ? "mobile" : "upload"
    });
    store.append({ type: "attachment.added", conversationId: conversation.id, attachment });
    res.status(201).json(attachment);
  });

  // ---- everything below requires a signed-in user ----
  api.use((req, _res, next) => {
    if (!req.user) throw Object.assign(new Error("Sign in to continue."), { status: 401 });
    next();
  });

  api.get("/info", (_req, res) => {
    const voice = transcriber.engine();
    const info: ServerInfo = {
      version: "2.0.0",
      providers: providers.status(),
      search: { configured: Boolean(search.provider()), provider: search.provider() },
      voice: { available: Boolean(voice), engine: voice },
      obsidian: { enabled: Boolean(config.obsidianVaultPath) },
      hermes: { configured: Boolean(config.hermes) },
      publicBaseUrl: config.publicBaseUrl ?? lanUrl(config.port)
    };
    res.json(info);
  });

  api.get("/council", (_req, res) => res.json(engine.council()));
  api.put("/council", (req, res) => {
    if (req.user!.role !== "admin") throw Object.assign(new Error("Only an administrator can change the council."), { status: 403 });
    res.json(engine.saveCouncil(req.body as CouncilConfig));
  });

  api.get("/conversations", (req, res) => res.json(store.summaries().filter((s) => canAccess(store.require(s.id), req.user!))));
  api.post("/conversations", (req, res) => {
    const body = req.body as CreateConversationRequest;
    const id = engine.createConversation(body?.title, body?.mode, req.user!.id);
    res.status(201).json(store.require(id));
  });
  api.get("/conversations/:id", (req, res) => res.json(owned(req.params.id, req.user)));
  api.get("/conversations/:id/upload-link", (req, res) => {
    const conversation = owned(req.params.id, req.user);
    const base = config.publicBaseUrl ?? lanUrl(config.port) ?? "";
    res.json({ url: `${base}/mobile/${conversation.id}?token=${signUploadToken(secret, conversation.id)}` });
  });
  api.patch("/conversations/:id", (req, res) => {
    const conversation = owned(req.params.id, req.user);
    const { title, archived, mode } = req.body as { title?: string; archived?: boolean; mode?: CaseMode };
    if (mode) engine.setMode(conversation.id, mode);
    if (typeof title === "string" && title.trim() && title.trim() !== conversation.title) {
      store.append({ type: "conversation.renamed", conversationId: conversation.id, title: title.trim().slice(0, 120) });
    }
    if (typeof archived === "boolean" && archived !== conversation.archived) {
      store.append({ type: "conversation.archived", conversationId: conversation.id, archived });
    }
    res.json(store.require(conversation.id));
  });

  api.post("/conversations/:id/messages", (req, res) => {
    const body = req.body as SendMessageRequest;
    owned(req.params.id, req.user);
    const turnId = engine.sendMessage(req.params.id, String(body?.prompt ?? ""), body?.council);
    res.status(202).json({ turnId });
  });
  api.post("/conversations/:id/clarification", (req, res) => {
    owned(req.params.id, req.user);
    engine.answerClarification(req.params.id, String((req.body as AnswerClarificationRequest)?.answer ?? ""));
    res.status(202).json({ ok: true });
  });
  api.post("/conversations/:id/cancel", (req, res) => {
    owned(req.params.id, req.user);
    engine.cancel(req.params.id);
    res.json({ ok: true });
  });

  api.get("/conversations/:id/turns/:turnId/brief.md", (req, res) => {
    const conversation = owned(req.params.id, req.user);
    const turn = conversation.turns.find((t) => t.id === req.params.turnId);
    if (!turn?.brief) throw Object.assign(new Error("Brief not found."), { status: 404 });
    res.type("text/markdown").setHeader("Content-Disposition", `attachment; filename="synod-second-opinion-v${turn.brief.version}.md"`);
    res.send(briefMarkdown(turn.brief, turn.prompt));
  });

  api.post("/conversations/:id/turns/:turnId/handoff", async (req, res) => {
    const conversation = owned(req.params.id, req.user);
    const turn = conversation.turns.find((t) => t.id === req.params.turnId);
    if (!turn) throw Object.assign(new Error("Turn not found."), { status: 404 });
    const result = await handOffToHermes(config.hermes, conversation, turn);
    store.append({ type: "turn.handed_off", conversationId: conversation.id, turnId: turn.id, result });
    res.json(result);
  });

  api.post("/transcribe", express.raw({ type: ["audio/*", "application/octet-stream"], limit: MAX_AUDIO_BYTES }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw Object.assign(new Error("Send audio as the raw request body."), { status: 400 });
    const language = typeof req.query.language === "string" ? req.query.language : "auto";
    res.json(await transcriber.transcribe(req.body, String(req.headers["content-type"] ?? "audio/webm"), language));
  });

  app.use("/api", api);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

  // Attachments are private: only the owner of the case they belong to can open them.
  app.use("/uploads", (req, res, next) => {
    const user = sessionUser(req, accounts);
    const url = `/uploads${req.path}`;
    const allowed = user && store.all().some((c) => canAccess(c, user) && [...c.pendingAttachments, ...c.turns.flatMap((t) => t.attachments)].some((a) => decodeURIComponent(a.url) === decodeURIComponent(url)));
    if (!allowed) return res.status(404).json({ error: "Not found." });
    next();
  });
  app.use("/uploads", express.static(uploadsDir, { fallthrough: false, setHeaders: (res) => res.setHeader("Content-Security-Policy", "sandbox") }));

  if (fs.existsSync(config.webDistDir)) {
    app.use(express.static(config.webDistDir, { index: false }));
    app.get("/{*path}", (_req, res) => res.sendFile(path.join(config.webDistDir, "index.html")));
  } else {
    app.get("/", (_req, res) => res.type("text").send("Synod API is running. Build the web app with `npm run build`, or use `npm run dev`."));
  }

  app.use((error: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    const status = error.status ?? (error.type === "entity.too.large" ? 413 : 500);
    // Errors with an explicit status are deliberate and safe to show; anything else is a bug.
    if (!error.status) console.error("[http]", error);
    res.status(status).json({ error: error.status ? error.message : "Internal server error." });
  });

  return app;
}

/** Best-guess LAN URL so a phone on the same network can open the mobile upload page. */
function lanUrl(port: number): string | null {
  for (const addresses of Object.values(os.networkInterfaces())) {
    const ip = addresses?.find((a) => a.family === "IPv4" && !a.internal);
    if (ip) return `http://${ip.address}:${port}`;
  }
  return null;
}
