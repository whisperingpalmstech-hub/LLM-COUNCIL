import crypto from "node:crypto";
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
import { AuthError, RateLimiter, readShareToken, signShareToken, signUploadToken, verifyUploadToken, type Accounts } from "../auth/accounts.ts";
import { renderDocument } from "../artifact/render.ts";
import { googleAuthUrl, googleProfile, OAUTH_COOKIE, readState } from "../auth/google.ts";
import { RECIPES } from "../council/recipes.ts";
import { clearSessionCookie, isHttps, readCookie, SESSION_COOKIE, sessionUser, setSessionCookie } from "./session.ts";

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
  api.get("/auth/config", (_req, res) => res.json({ signup: signupMode(), google: Boolean(config.google) } satisfies AuthConfigResponse));

  // ---- Continue with Google ----
  const googleRedirect = (req: Request) => {
    const base = config.publicBaseUrl ?? `${isHttps(req) ? "https" : "http"}://${req.headers.host}`;
    return `${base}/api/auth/google/callback`;
  };
  api.get("/auth/google/start", (req, res) => {
    if (!config.google) throw new AuthError("Google sign-in isn't set up on this server.", 404);
    const next = typeof req.query.next === "string" && req.query.next.startsWith("/") ? req.query.next : undefined;
    const invite = typeof req.query.invite === "string" ? req.query.invite.trim().slice(0, 100) : undefined;
    const { url, nonce } = googleAuthUrl(config.google, googleRedirect(req), secret, { ...(next ? { next } : {}), ...(invite ? { invite } : {}) });
    res.setHeader("Set-Cookie", `${OAUTH_COOKIE}=${nonce}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${isHttps(req) ? "; Secure" : ""}`);
    res.redirect(302, url);
  });
  api.get("/auth/google/callback", async (req, res) => {
    const fail = (message: string) => res.redirect(302, `/login?error=${encodeURIComponent(message)}`);
    try {
      if (!config.google) throw new AuthError("Google sign-in isn't set up on this server.", 404);
      if (typeof req.query.error === "string") return fail("Google sign-in was cancelled.");
      const state = readState(secret, String(req.query.state ?? ""), readCookie(req, OAUTH_COOKIE));
      const profile = await googleProfile(config.google, googleRedirect(req), String(req.query.code ?? ""));
      const user = accounts.googleUser(profile, () => {
        const mode = signupMode();
        if (mode === "first-user") return "admin";
        if (mode === "open") return "member";
        if (mode === "invite" && state.invite && state.invite === config.signup.inviteCode) return "member";
        return null;
      });
      const session = accounts.createSession(user.id);
      setSessionCookie(req, res, session.token, session.expires);
      res.redirect(302, user.profile ? (state.next ?? "/new") : "/welcome");
    } catch (error) {
      fail(error instanceof AuthError ? error.message : "Google sign-in failed. Please try again.");
    }
  });
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

  // Each person's own council settings (defaults: recommended councils, standard depth).
  api.get("/council", (req, res) => res.json(engine.council(req.user!.id)));
  api.put("/council", (req, res) => res.json(engine.saveCouncil(req.body as CouncilConfig, req.user!.id)));
  api.get("/council/recipes", (_req, res) => res.json({ available: engine.autoAvailable(), recipes: RECIPES }));

  api.put("/me/profile", (req, res) => res.json({ user: accounts.setProfile(req.user!.id, req.body) }));

  api.get("/conversations", (req, res) => res.json(store.summaries().filter((s) => canAccess(store.require(s.id), req.user!))));
  api.post("/conversations", (req, res) => {
    const body = req.body as CreateConversationRequest;
    const id = engine.createConversation(body?.title, body?.mode, req.user!.id, body?.kind === "chat" ? "chat" : "council");
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

  api.post("/conversations/:id/messages", async (req, res) => {
    const body = req.body as SendMessageRequest;
    owned(req.params.id, req.user);
    const turnId = await engine.sendMessage(req.params.id, String(body?.prompt ?? ""), {
      override: body?.council,
      depth: body?.depth,
      timezone: typeof body?.timezone === "string" ? body.timezone.slice(0, 64) : undefined,
      profile: req.user!.profile,
      userId: req.user!.id
    });
    res.status(202).json({ turnId });
  });
  // ---- Discuss mode ----
  const sendOptions = (req: Request) => ({
    timezone: typeof req.body?.timezone === "string" ? req.body.timezone.slice(0, 64) : undefined,
    profile: req.user!.profile,
    userId: req.user!.id
  });
  api.post("/conversations/:id/chat", async (req, res) => {
    owned(String(req.params.id), req.user);
    await engine.chat(String(req.params.id), String(req.body?.text ?? ""), sendOptions(req));
    res.status(202).json({ ok: true });
  });
  api.post("/conversations/:id/chat/stop", (req, res) => {
    owned(String(req.params.id), req.user);
    engine.stopDiscussion(String(req.params.id));
    res.json({ ok: true });
  });
  api.post("/conversations/:id/wrap-up", async (req, res) => {
    owned(String(req.params.id), req.user);
    const turnId = await engine.wrapUp(String(req.params.id), sendOptions(req));
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

  // ---- the second-opinion document ----
  const turnWithBrief = (req: Request) => {
    const conversation = owned(String(req.params.id), req.user);
    const turn = conversation.turns.find((t) => t.id === req.params.turnId);
    if (!turn?.brief) throw Object.assign(new Error("This answer has no brief yet."), { status: 404 });
    return { conversation, turn, brief: turn.brief };
  };
  api.get("/conversations/:id/turns/:turnId/brief.html", (req, res) => {
    const { turn, brief } = turnWithBrief(req);
    const theme = req.query.theme === "dark" || req.query.theme === "light" ? req.query.theme : undefined;
    const doc = renderDocument(turn, brief, { embed: req.query.embed === "1", theme });
    res.setHeader("Content-Security-Policy", doc.csp);
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Cache-Control", "private, no-store");
    if (req.query.download === "1") res.setHeader("Content-Disposition", `attachment; filename="synod-second-opinion-v${brief.version}.html"`);
    res.type("html").send(doc.html);
  });
  api.post("/conversations/:id/turns/:turnId/share", (req, res) => {
    const { conversation, turn } = turnWithBrief(req);
    const days = [1, 7, 30].includes(Number(req.body?.days)) ? Number(req.body.days) : 1;
    const expires = Date.now() + days * 86_400_000;
    const share = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), expiresAt: new Date(expires).toISOString() };
    store.append({ type: "turn.shared", conversationId: conversation.id, turnId: turn.id, share });
    const base = config.publicBaseUrl ?? `${isHttps(req) ? "https" : "http"}://${req.headers.host}`;
    res.status(201).json({ share, url: `${base}/s/${signShareToken(secret, { c: conversation.id, t: turn.id, s: share.id, e: expires })}` });
  });
  api.delete("/conversations/:id/turns/:turnId/share/:shareId", (req, res) => {
    const { conversation, turn } = turnWithBrief(req);
    if (!turn.shares?.some((s) => s.id === req.params.shareId)) throw Object.assign(new Error("Share link not found."), { status: 404 });
    store.append({ type: "turn.share_revoked", conversationId: conversation.id, turnId: turn.id, shareId: String(req.params.shareId) });
    res.json({ ok: true });
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

  // Public, read-only shared documents. No scripts, not indexable, not cached by proxies.
  app.get("/s/:token", (req, res) => {
    const notFound = () =>
      res
        .status(404)
        .setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
        .type("html")
        .send('<!doctype html><meta name="robots" content="noindex"><title>Link unavailable</title><body style="font:15px system-ui;margin:20vh auto;max-width:28rem;color:#555;text-align:center"><h1 style="font-size:1.2rem;color:#111">This link is no longer available</h1><p>It may have expired or been turned off by the person who shared it. Ask them for a new link.</p></body>');
    const token = readShareToken(secret, String(req.params.token));
    if (!token) return notFound();
    const turn = store.get(token.c)?.turns.find((t) => t.id === token.t);
    const share = turn?.shares?.find((s) => s.id === token.s);
    if (!turn?.brief || !share || share.revoked) return notFound();
    const until = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(new Date(share.expiresAt));
    const doc = renderDocument(turn, turn.brief, { sharedUntil: until });
    res.setHeader("Content-Security-Policy", doc.csp);
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "private, no-store");
    res.type("html").send(doc.html);
  });

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
