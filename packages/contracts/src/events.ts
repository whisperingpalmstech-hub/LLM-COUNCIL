// Event-sourced conversation log. The server appends events; both server and
// client fold them through `applyEvent` to get the same Conversation view.

import type {
  Attachment,
  Conversation,
  CouncilConfig,
  ExecutionPlan,
  HandoffResult,
  SearchResult,
  Stage1Response,
  Stage2Aggregate,
  Stage2Review,
  Synthesis,
  TurnStage
} from "./model.ts";

type E<T extends string, P> = { type: T; seq: number; conversationId: string; at: string } & P;

export type ConversationEvent =
  | E<"conversation.created", { title: string }>
  | E<"conversation.renamed", { title: string }>
  | E<"conversation.archived", { archived: boolean }>
  | E<"attachment.added", { attachment: Attachment }>
  | E<"turn.started", { turnId: string; prompt: string; council: CouncilConfig }>
  | E<"turn.stage_started", { turnId: string; stage: TurnStage }>
  | E<"turn.clarification_requested", { turnId: string; question: string }>
  | E<"turn.clarification_answered", { turnId: string; answer: string }>
  | E<"turn.research_completed", { turnId: string; results: SearchResult[] }>
  | E<"turn.stage1_response", { turnId: string; response: Stage1Response }>
  | E<"turn.stage2_review", { turnId: string; review: Stage2Review }>
  | E<"turn.stage2_aggregated", { turnId: string; aggregate: Stage2Aggregate }>
  | E<"turn.synthesis_completed", { turnId: string; synthesis: Synthesis }>
  | E<"turn.plan_generated", { turnId: string; plan: ExecutionPlan }>
  | E<"turn.plan_handed_off", { turnId: string; result: HandoffResult }>
  | E<"turn.completed", { turnId: string }>
  | E<"turn.failed", { turnId: string; error: string }>;

/** Distributive Omit so each union member keeps its own payload. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewConversationEvent = DistributiveOmit<ConversationEvent, "seq" | "at">;

/** Messages pushed from server to browser over the WebSocket. */
export type ServerPush = { type: "event"; event: ConversationEvent };

export function emptyConversation(id: string): Conversation {
  return { id, title: "", archived: false, createdAt: "", updatedAt: "", pendingAttachments: [], turns: [], seq: 0 };
}

export function applyEvent(state: Conversation, event: ConversationEvent): Conversation {
  if (event.seq <= state.seq) return state;
  const next: Conversation = { ...state, seq: event.seq, updatedAt: event.at };
  const turnIndex = "turnId" in event ? next.turns.findIndex((t) => t.id === event.turnId) : -1;
  const patchTurn = (patch: (turn: Conversation["turns"][number]) => Partial<Conversation["turns"][number]>) => {
    if (turnIndex < 0) return;
    const turns = next.turns.slice();
    turns[turnIndex] = { ...turns[turnIndex], ...patch(turns[turnIndex]) };
    next.turns = turns;
  };

  switch (event.type) {
    case "conversation.created":
      next.title = event.title;
      next.createdAt = event.at;
      break;
    case "conversation.renamed":
      next.title = event.title;
      break;
    case "conversation.archived":
      next.archived = event.archived;
      break;
    case "attachment.added":
      next.pendingAttachments = [...next.pendingAttachments, event.attachment];
      break;
    case "turn.started":
      next.turns = [
        ...next.turns,
        {
          id: event.turnId,
          prompt: event.prompt,
          attachments: next.pendingAttachments,
          status: "running",
          stage: null,
          council: event.council,
          research: [],
          stage1: [],
          stage2: [],
          startedAt: event.at
        }
      ];
      next.pendingAttachments = [];
      break;
    case "turn.stage_started":
      patchTurn(() => ({ stage: event.stage, status: "running" }));
      break;
    case "turn.clarification_requested":
      patchTurn(() => ({ status: "awaiting_clarification", clarification: { question: event.question } }));
      break;
    case "turn.clarification_answered":
      patchTurn((t) => ({ status: "running", clarification: { question: t.clarification?.question ?? "", answer: event.answer } }));
      break;
    case "turn.research_completed":
      patchTurn(() => ({ research: event.results }));
      break;
    case "turn.stage1_response":
      patchTurn((t) => ({ stage1: [...t.stage1, event.response] }));
      break;
    case "turn.stage2_review":
      patchTurn((t) => ({ stage2: [...t.stage2, event.review] }));
      break;
    case "turn.stage2_aggregated":
      patchTurn(() => ({ aggregate: event.aggregate }));
      break;
    case "turn.synthesis_completed":
      patchTurn(() => ({ synthesis: event.synthesis }));
      break;
    case "turn.plan_generated":
      patchTurn(() => ({ plan: event.plan }));
      break;
    case "turn.plan_handed_off":
      patchTurn(() => ({ handoff: event.result }));
      break;
    case "turn.completed":
      patchTurn(() => ({ status: "completed", stage: null, completedAt: event.at }));
      break;
    case "turn.failed":
      patchTurn(() => ({ status: "failed", stage: null, error: event.error, completedAt: event.at }));
      break;
  }
  return next;
}
