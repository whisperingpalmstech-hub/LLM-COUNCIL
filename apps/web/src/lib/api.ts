import type {
  Attachment,
  CaseMode,
  Conversation,
  ConversationSummary,
  CouncilConfig,
  HandoffResult,
  ServerInfo,
  TranscriptionResponse,
  UploadAttachmentRequest
} from "@synod/contracts";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init.body && typeof init.body === "string" ? { "Content-Type": "application/json", ...init.headers } : init.headers
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });

export const api = {
  info: () => request<ServerInfo>("/api/info"),
  council: () => request<CouncilConfig>("/api/council"),
  saveCouncil: (council: CouncilConfig) => request<CouncilConfig>("/api/council", { method: "PUT", body: JSON.stringify(council) }),
  conversations: () => request<ConversationSummary[]>("/api/conversations"),
  conversation: (id: string) => request<Conversation>(`/api/conversations/${id}`),
  createConversation: (mode: CaseMode) => post<Conversation>("/api/conversations", { mode }),
  updateConversation: (id: string, patch: { title?: string; archived?: boolean; mode?: CaseMode }) =>
    request<Conversation>(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  send: (id: string, prompt: string) => post<{ turnId: string }>(`/api/conversations/${id}/messages`, { prompt }),
  answer: (id: string, answer: string) => post(`/api/conversations/${id}/clarification`, { answer }),
  cancel: (id: string) => post(`/api/conversations/${id}/cancel`),
  handoff: (id: string, turnId: string) => post<HandoffResult>(`/api/conversations/${id}/turns/${turnId}/handoff`),
  briefUrl: (id: string, turnId: string) => `/api/conversations/${id}/turns/${turnId}/brief.md`,
  upload: (id: string, body: UploadAttachmentRequest) => post<Attachment>(`/api/conversations/${id}/attachments`, body),
  transcribe: (audio: Blob, language = "auto") =>
    request<TranscriptionResponse>(`/api/transcribe?language=${encodeURIComponent(language)}`, {
      method: "POST",
      headers: { "Content-Type": audio.type || "audio/webm" },
      body: audio
    })
};

export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
