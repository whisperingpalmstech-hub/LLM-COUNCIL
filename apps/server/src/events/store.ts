import type { DatabaseSync } from "node:sqlite";
import {
  applyEvent,
  emptyConversation,
  type Conversation,
  type ConversationEvent,
  type ConversationSummary,
  type DraftPush,
  type NewConversationEvent
} from "@synod/contracts";

type Listener = (event: ConversationEvent) => void;
type DraftListener = (draft: DraftPush) => void;

/**
 * Append-only event store with an in-memory projection per conversation.
 * Every state change goes through `append`, which persists, projects, and broadcasts.
 */
export class EventStore {
  private readonly db: DatabaseSync;
  private readonly projections = new Map<string, Conversation>();
  private readonly listeners = new Set<Listener>();
  private readonly draftListeners = new Set<DraftListener>();

  constructor(db: DatabaseSync) {
    this.db = db;
    const rows = db.prepare("SELECT * FROM events ORDER BY seq").all() as unknown as EventRow[];
    for (const row of rows) this.project(fromRow(row));
  }

  append(input: NewConversationEvent): ConversationEvent {
    const at = new Date().toISOString();
    const { type, conversationId, ...payload } = input;
    const result = this.db
      .prepare("INSERT INTO events(conversation_id, type, at, payload) VALUES(?, ?, ?, ?)")
      .run(conversationId, type, at, JSON.stringify(payload));
    const event = { ...input, seq: Number(result.lastInsertRowid), at } as ConversationEvent;
    this.project(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[events] listener failed", error);
      }
    }
    return event;
  }

  /** Broadcast streaming text without persisting it. */
  publishDraft(draft: DraftPush): void {
    for (const listener of this.draftListeners) listener(draft);
  }

  subscribeDrafts(listener: DraftListener): () => void {
    this.draftListeners.add(listener);
    return () => this.draftListeners.delete(listener);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get(conversationId: string): Conversation | undefined {
    return this.projections.get(conversationId);
  }

  require(conversationId: string): Conversation {
    const conversation = this.get(conversationId);
    if (!conversation) throw Object.assign(new Error("Conversation not found."), { status: 404 });
    return conversation;
  }

  all(): Conversation[] {
    return [...this.projections.values()];
  }

  summaries(): ConversationSummary[] {
    return this.all()
      .map((c): ConversationSummary => {
        const last = c.turns.at(-1);
        const status = c.chatBusy || last?.status === "running" ? "running" : (last?.status ?? "idle");
        return { id: c.id, kind: c.kind, title: c.title, mode: c.mode, archived: c.archived, updatedAt: c.updatedAt, turnCount: c.kind === "chat" ? c.chat.length : c.turns.length, status };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private project(event: ConversationEvent): void {
    const current = this.projections.get(event.conversationId) ?? emptyConversation(event.conversationId);
    this.projections.set(event.conversationId, applyEvent(current, event));
  }
}

interface EventRow {
  seq: number;
  conversation_id: string;
  type: string;
  at: string;
  payload: string;
}

function fromRow(row: EventRow): ConversationEvent {
  return { ...JSON.parse(row.payload), type: row.type, seq: Number(row.seq), conversationId: row.conversation_id, at: row.at } as ConversationEvent;
}
