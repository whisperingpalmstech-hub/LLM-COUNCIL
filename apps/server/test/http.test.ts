import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { WebSocket } from "ws";
import type { Conversation, ServerPush } from "@synod/contracts";
import { loadConfig } from "../src/config.ts";
import { createServer } from "../src/main.ts";

const auth = "Basic " + Buffer.from("synod:secret").toString("base64");
let base = "";
let instance: ReturnType<typeof createServer>;

before(async () => {
  instance = createServer(loadConfig({ DATABASE_PATH: ":memory:", SYNOD_ACCESS_PASSWORD: "secret", SYNOD_DATA_DIR: "/tmp/synod-http-test", WEB_DIST_DIR: "/nonexistent" }));
  await new Promise<void>((r) => instance.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(instance.server.address() as AddressInfo).port}`;
});

after(() => {
  instance.server.closeAllConnections();
  instance.server.close();
});

const api = (path: string, init: RequestInit = {}) =>
  fetch(base + path, { ...init, headers: { authorization: auth, "content-type": "application/json", ...init.headers } });

test("health is public; everything else requires auth", async () => {
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/conversations`)).status, 401);
  assert.equal((await api("/api/conversations")).status, 200);
});

test("end to end: create, attach, ask, stream events over WebSocket, download plan", async () => {
  await api("/api/council", { method: "PUT", body: JSON.stringify({ ...(await (await api("/api/council")).json()), clarify: false }) });
  const conversation = (await (await api("/api/conversations", { method: "POST", body: "{}" })).json()) as Conversation;

  const attachment = await api(`/api/conversations/${conversation.id}/attachments`, {
    method: "POST",
    body: JSON.stringify({ name: "notes.md", mimeType: "text/markdown", data: Buffer.from("# Budget\n$40k").toString("base64") })
  });
  assert.equal(attachment.status, 201);

  const ws = new WebSocket(base.replace("http", "ws") + "/ws", { headers: { authorization: auth } });
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

  const sent = await api(`/api/conversations/${conversation.id}/messages`, { method: "POST", body: JSON.stringify({ prompt: "What budget should we allocate to the pilot described in the notes?" }) });
  assert.equal(sent.status, 202);
  const { turnId } = (await sent.json()) as { turnId: string };
  await completed;
  ws.close();

  assert.ok(types.includes("turn.stage1_response"));
  assert.ok(types.includes("turn.stage2_aggregated"));
  assert.ok(types.includes("turn.plan_generated"));
  assert.equal(types.at(-1), "turn.completed");

  const full = (await (await api(`/api/conversations/${conversation.id}`)).json()) as Conversation;
  assert.equal(full.turns[0].attachments[0].name, "notes.md");
  assert.match(full.turns[0].attachments[0].excerpt ?? "", /\$40k/);
  assert.equal(full.pendingAttachments.length, 0);

  const md = await api(`/api/conversations/${conversation.id}/turns/${turnId}/plan.md`);
  assert.equal(md.status, 200);
  assert.match(await md.text(), /## Phases/);

  const handoff = await api(`/api/conversations/${conversation.id}/turns/${turnId}/handoff`, { method: "POST" });
  assert.deepEqual(((await handoff.json()) as { simulated: boolean }).simulated, true);
});

test("errors come back as JSON with the right status", async () => {
  const missing = await api("/api/conversations/nope");
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "Conversation not found." });
  const conversation = (await (await api("/api/conversations", { method: "POST", body: "{}" })).json()) as Conversation;
  const empty = await api(`/api/conversations/${conversation.id}/messages`, { method: "POST", body: JSON.stringify({ prompt: "  " }) });
  assert.equal(empty.status, 400);
});
