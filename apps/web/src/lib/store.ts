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
  private listeners = new Set<Listener>();
  private socket: WebSocket | null = null;
  private retry = 0;
  private summaryTimer: number | undefined;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    for (const l of this.listeners) l();
  }

  connect() {
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
      const { event } = push;
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
      setTimeout(() => this.connect(), Math.min(10_000, 500 * 2 ** this.retry++));
    };
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
