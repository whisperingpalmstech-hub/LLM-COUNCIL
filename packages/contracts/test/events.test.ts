import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEvent, DEFAULT_DISCUSSION, emptyConversation, type ConversationEvent, type CouncilConfig } from "../src/index.ts";

const council: CouncilConfig = {
  auto: false,
  depth: "quick",
  members: [{ id: "a", label: "A", provider: "mock", model: "" }],
  chairman: { id: "a", label: "A", provider: "mock", model: "" },
  clarify: false,
  brief: false,
  webSearch: false, discussion: DEFAULT_DISCUSSION
};
const base = { conversationId: "c", at: "2026-01-01T00:00:00.000Z" };

test("pending attachments move into the next turn", () => {
  const events: ConversationEvent[] = [
    { ...base, seq: 1, type: "conversation.created", title: "T", mode: "medical" },
    { ...base, seq: 2, type: "attachment.added", attachment: { id: "f", name: "a.txt", mimeType: "text/plain", size: 1, url: "/u", source: "upload" } },
    { ...base, seq: 3, type: "turn.started", turnId: "t", prompt: "hi", mode: "medical", council }
  ];
  const state = events.reduce(applyEvent, emptyConversation("c"));
  assert.equal(state.pendingAttachments.length, 0);
  assert.equal(state.turns[0].attachments[0].id, "f");
});

test("events at or below the current seq are ignored (idempotent replay)", () => {
  const created: ConversationEvent = { ...base, seq: 1, type: "conversation.created", title: "T", mode: "medical" };
  const once = applyEvent(emptyConversation("c"), created);
  assert.equal(applyEvent(once, created), once);
});
