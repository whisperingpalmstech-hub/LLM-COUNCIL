// Client state: conversation snapshots from REST, kept live by folding pushed
// events through the same reducer the server uses.

import { useEffect, useSyncExternalStore } from "react";
import { applyEvent, type Conversation, type ConversationSummary, type ServerPush } from "@synod/contracts";
import { api } from "./api";

type Listener = () => void;

class ClientStore {
  conversations = new Map<string, Conversation>();
  summaries: ConversationSummary[] = [];
  connected = false;
  /** Live partial text by `${turnId}:${key}`; dropped once the final event lands. */
  drafts = new Map<string, string>();
  /** Bumps on every draft update so views can follow streaming text. */
  draftRev = 0;
  private listeners = new Set<Listener>();
  private socket: WebSocket | null = null;
  private retry = 0;
  private stopped = false;
  private summaryTimer: number | undefined;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    for (const l of this.listeners) l();
  }

  connect() {
    this.stopped = false;
    if (this.socket) return;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      this.retry = 0;
      this.connected = true;
      // Anything could have happened while disconnected: refetch what we hold.
      void this.refreshSummaries();
      for (const id of this.conversations.keys()) void this.load(id);
      this.emit();
    };
    socket.onmessage = (message) => {
      const push = JSON.parse(String(message.data)) as ServerPush;
      if (push.type === "draft") {
        if (this.isFinal(push.conversationId, push.turnId, push.key)) return;
        this.drafts = new Map(this.drafts).set(`${push.turnId}:${push.key}`, push.text);
        this.draftRev++;
        this.emit();
        return;
      }
      const { event } = push;
      const finalKey =
        event.type === "turn.stage1_response" ? `${event.turnId}:stage1:${event.response.memberId}` : event.type === "turn.synthesis_completed" ? `${event.turnId}:synthesis` : null;
      if (finalKey && this.drafts.has(finalKey)) {
        this.drafts = new Map(this.drafts);
        this.drafts.delete(finalKey);
      }
      const current = this.conversations.get(event.conversationId);
      if (current) {
        this.conversations = new Map(this.conversations).set(event.conversationId, applyEvent(current, event));
        this.emit();
      }
      this.scheduleSummaries();
    };
    socket.onclose = () => {
      this.socket = null;
      this.connected = false;
      this.emit();
      if (!this.stopped) setTimeout(() => this.connect(), Math.min(10_000, 500 * 2 ** this.retry++));
    };
  }

  /** A late draft must not resurrect text whose final version has arrived. */
  private isFinal(conversationId: string, turnId: string, key: string): boolean {
    const turn = this.conversations.get(conversationId)?.turns.find((t) => t.id === turnId);
    if (!turn) return false;
    if (key === "synthesis") return Boolean(turn.synthesis);
    const memberId = key.slice("stage1:".length);
    return turn.stage1.some((r) => r.memberId === memberId);
  }

  /** On sign-out: close the socket and forget everything. */
  reset() {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
    this.conversations = new Map();
    this.summaries = [];
    this.drafts = new Map();
    this.emit();
  }

  async load(id: string) {
    const conversation = await api.conversation(id);
    const current = this.conversations.get(id);
    if (!current || conversation.seq >= current.seq) {
      this.conversations = new Map(this.conversations).set(id, conversation);
      this.emit();
    }
    return conversation;
  }

  async refreshSummaries() {
    this.summaries = await api.conversations();
    this.emit();
  }

  private scheduleSummaries() {
    clearTimeout(this.summaryTimer);
    this.summaryTimer = window.setTimeout(() => void this.refreshSummaries(), 250);
  }
}

export const store = new ClientStore();

export function useConversation(id: string | null): Conversation | undefined {
  useEffect(() => {
    if (id) void store.load(id).catch(() => undefined);
  }, [id]);
  return useSyncExternalStore(store.subscribe, () => (id ? store.conversations.get(id) : undefined));
}

export function useSummaries(): ConversationSummary[] {
  return useSyncExternalStore(store.subscribe, () => store.summaries);
}

export function useConnected(): boolean {
  return useSyncExternalStore(store.subscribe, () => store.connected);
}

export function useDraft(turnId: string, key: string): string | undefined {
  return useSyncExternalStore(store.subscribe, () => store.drafts.get(`${turnId}:${key}`));
}

export function useDraftRev(): number {
  return useSyncExternalStore(store.subscribe, () => store.draftRev);
}
