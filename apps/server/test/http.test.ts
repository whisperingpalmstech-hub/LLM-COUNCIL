import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { WebSocket } from "ws";
import type { Attachment, Conversation, ServerPush } from "@synod/contracts";
import { loadConfig } from "../src/config.ts";
import { createServer } from "../src/main.ts";

let base = "";
let instance: ReturnType<typeof createServer>;

before(async () => {
  instance = createServer(
    loadConfig({ DATABASE_PATH: ":memory:", SYNOD_INVITE_CODE: "let-me-in", SYNOD_DATA_DIR: "/tmp/synod-http-test", WEB_DIST_DIR: "/nonexistent", SYNOD_SECRET: "test-secret" })
  );
  await new Promise<void>((r) => instance.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(instance.server.address() as AddressInfo).port}`;
});

after(() => {
  instance.server.closeAllConnections();
  instance.server.close();
});

/** A tiny cookie-keeping client. */
function client() {
  let cookie = "";
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...init.headers } });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return res;
  };
  return { call, cookie: () => cookie };
}

const signup = (c: ReturnType<typeof client>, email: string, extra: object = {}) =>
  c.call("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: email.split("@")[0], email, password: "correct horse battery", ...extra }) });

const admin = client();
const alice = client();

test("the first account becomes admin; later sign-ups need the invite code", async () => {
  assert.equal(((await (await admin.call("/api/auth/config")).json()) as { signup: string }).signup, "first-user");
  const first = await signup(admin, "admin@example.com");
  assert.equal(first.status, 201);
  assert.equal(((await first.json()) as { user: { role: string } }).user.role, "admin");
  assert.match(first.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Lax/);

  assert.equal(((await (await alice.call("/api/auth/config")).json()) as { signup: string }).signup, "invite");
  assert.equal((await signup(alice, "alice@example.com", { inviteCode: "wrong" })).status, 403);
  assert.equal((await signup(alice, "alice@example.com", { inviteCode: "let-me-in" })).status, 201);
  assert.equal((await signup(client(), "alice@example.com", { inviteCode: "let-me-in" })).status, 409);
});

test("sign-in, sign-out, and protected routes", async () => {
  const c = client();
  assert.equal((await c.call("/api/conversations")).status, 401);
  assert.equal((await c.call("/api/auth/login", { method: "POST", body: JSON.stringify({ email: "alice@example.com", password: "nope nope nope" }) })).status, 401);
  assert.equal((await c.call("/api/auth/login", { method: "POST", body: JSON.stringify({ email: "ALICE@example.com", password: "correct horse battery" }) })).status, 200);
  assert.equal((await c.call("/api/conversations")).status, 200);
  await c.call("/api/auth/logout", { method: "POST" });
  assert.equal((await c.call("/api/auth/me")).status, 401);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});

test("cases are private to their owner, including over the WebSocket", async () => {
  const mine = (await (await alice.call("/api/conversations", { method: "POST", body: "{}" })).json()) as Conversation;
  assert.equal((await admin.call(`/api/conversations/${mine.id}`)).status, 404);
  const adminList = (await (await admin.call("/api/conversations")).json()) as { id: string }[];
  assert.ok(!adminList.some((s) => s.id === mine.id));
  assert.equal((await admin.call("/api/council", { method: "PUT", body: JSON.stringify({ ...(await (await admin.call("/api/council")).json()), clarify: false }) })).status, 200);
  assert.equal((await alice.call("/api/council", { method: "PUT", body: "{}" })).status, 403);

  const adminSocket = new WebSocket(base.replace("http", "ws") + "/ws", { headers: { cookie: admin.cookie() } });
  const leaked: string[] = [];
  adminSocket.on("message", (raw) => {
    const push = JSON.parse(String(raw)) as ServerPush;
    const id = push.type === "event" ? push.event.conversationId : push.conversationId;
    if (id === mine.id) leaked.push(push.type);
  });
  await new Promise((r) => adminSocket.on("open", r));
  await alice.call(`/api/conversations/${mine.id}/messages`, { method: "POST", body: JSON.stringify({ prompt: "A long enough question for the mock council to answer directly." }) });
  await instance.engine.idle();
  adminSocket.close();
  assert.deepEqual(leaked, []);
});

test("end to end: attach, ask, stream events, export the brief", async () => {
  const conversation = (await (await alice.call("/api/conversations", { method: "POST", body: JSON.stringify({ mode: "legal" }) })).json()) as Conversation;
  assert.equal(conversation.mode, "legal");
  const attachment = await alice.call(`/api/conversations/${conversation.id}/attachments`, {
    method: "POST",
    body: JSON.stringify({ name: "notes.md", mimeType: "text/markdown", data: Buffer.from("# Contract\nNon-compete, 2 years").toString("base64") })
  });
  assert.equal(attachment.status, 201);
  const { url } = (await attachment.json()) as Attachment;
  assert.equal((await alice.call(url)).status, 200, "owner can open their file");
  assert.equal((await admin.call(url)).status, 404, "other users cannot");

  const ws = new WebSocket(base.replace("http", "ws") + "/ws", { headers: { cookie: alice.cookie() } });
  const types: string[] = [];
  const completed = new Promise<void>((resolve) =>
    ws.on("message", (raw) => {
      const push = JSON.parse(String(raw)) as ServerPush;
      if (push.type === "event" && push.event.conversationId === conversation.id) {
        types.push(push.event.type);
        if (push.event.type === "turn.completed" || push.event.type === "turn.failed") resolve();
      }
    })
  );
  await new Promise((r) => ws.on("open", r));
  const sent = await alice.call(`/api/conversations/${conversation.id}/messages`, { method: "POST", body: JSON.stringify({ prompt: "Is the non-compete in the attached contract enforceable in California?" }) });
  const { turnId } = (await sent.json()) as { turnId: string };
  await completed;
  ws.close();
  assert.ok(types.includes("turn.brief_generated"));
  assert.equal(types.at(-1), "turn.completed");

  const md = await alice.call(`/api/conversations/${conversation.id}/turns/${turnId}/brief.md`);
  assert.match(await md.text(), /## Next steps/);
});

test("a signed QR link lets a phone upload to one case without signing in", async () => {
  const conversation = (await (await alice.call("/api/conversations", { method: "POST", body: "{}" })).json()) as Conversation;
  const { url } = (await (await alice.call(`/api/conversations/${conversation.id}/upload-link`)).json()) as { url: string };
  const token = new URL(url).searchParams.get("token")!;
  const body = JSON.stringify({ name: "photo.txt", mimeType: "text/plain", data: Buffer.from("hi").toString("base64"), source: "mobile" });
  const phone = (path: string) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body });
  assert.equal((await phone(`/api/conversations/${conversation.id}/attachments?token=${token}`)).status, 201);
  assert.equal((await phone(`/api/conversations/${conversation.id}/attachments?token=bad.token`)).status, 401);
  const other = (await (await alice.call("/api/conversations", { method: "POST", body: "{}" })).json()) as Conversation;
  assert.equal((await phone(`/api/conversations/${other.id}/attachments?token=${token}`)).status, 401, "token is bound to its case");
});
