// REST request/response shapes. Commands go over REST; state changes come back as events over the WebSocket.

import type { Attachment, CaseMode, CouncilConfig } from "./model.ts";

export interface CreateConversationRequest {
  title?: string;
  mode?: CaseMode;
}

export interface SendMessageRequest {
  prompt: string;
  /** Override the saved council for this turn only. */
  council?: Partial<CouncilConfig>;
}

export interface AnswerClarificationRequest {
  answer: string;
}

export interface UploadAttachmentRequest {
  name: string;
  mimeType: string;
  /** Base64 file content (no data: prefix). */
  data: string;
  source?: Attachment["source"];
}

export interface TranscriptionResponse {
  text: string;
  engine: string;
}
