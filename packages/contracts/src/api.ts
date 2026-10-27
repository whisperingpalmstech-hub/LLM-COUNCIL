// REST request/response shapes. Commands go over REST; state changes come back as events over the WebSocket.

import type { Attachment, AuthUser, CaseMode, CouncilConfig, Depth, SignupMode } from "./model.ts";

export interface AuthConfigResponse {
  signup: SignupMode;
  /** "Continue with Google" is available. */
  google: boolean;
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
  /** "auto" classifies the case from its first message. */
  mode?: CaseMode | "auto";
}

export interface SendMessageRequest {
  prompt: string;
  /** Deliberation depth for this message (defaults to the user's setting). */
  depth?: Depth;
  /** Client clock, so the council knows today's date in the user's timezone. */
  timezone?: string;
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
