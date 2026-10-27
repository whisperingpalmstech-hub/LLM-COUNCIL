import type { DatabaseSync } from "node:sqlite";
import {
  applyEvent,
  emptyConversation,
  type Conversation,
  type ConversationEvent,
  type ConversationSummary,
  type NewConversationEvent
} from "@synod/contracts";

type Listener = (event: ConversationEvent) => void;

/**
 * Append-only event store with an in-memory projection per conversation.
 * Every state change goes through `append`, which persists, projects, and broadcasts.
 */
export class EventStore {
  private readonly db: DatabaseSync;
  private readonly projections = new Map<string, Conversation>();
  private readonly listeners = new Set<Listener>();

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
        return { id: c.id, title: c.title, archived: c.archived, updatedAt: c.updatedAt, turnCount: c.turns.length, status: last?.status ?? "idle" };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  eventsSince(seq: number): ConversationEvent[] {
    const rows = this.db.prepare("SELECT * FROM events WHERE seq > ? ORDER BY seq").all(seq) as unknown as EventRow[];
    return rows.map(fromRow);
  }

  latestSeq(): number {
    const row = this.db.prepare("SELECT max(seq) AS seq FROM events").get() as { seq: number | null };
    return Number(row.seq ?? 0);
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
