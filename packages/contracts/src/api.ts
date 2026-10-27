// REST request/response shapes. Commands go over REST; state changes come back as events over the WebSocket.

import type { Attachment, AuthUser, CaseMode, CouncilConfig, SignupMode } from "./model.ts";

export interface AuthConfigResponse {
  signup: SignupMode;
}

export interface MeResponse {
  user: AuthUser;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest extends LoginRequest {
  name: string;
  inviteCode?: string;
}

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
