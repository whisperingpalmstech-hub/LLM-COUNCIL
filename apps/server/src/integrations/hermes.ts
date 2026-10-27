import type { Conversation, HandoffResult, Turn } from "@synod/contracts";
import { errorMessage } from "../providers/http.ts";

/**
 * Sends a council brief to an external executor (Hermes) — only when the user
 * explicitly asks. Without a webhook URL the hand-off is simulated.
 */
export async function handOffToHermes(
  hermes: { url: string; apiKey: string | null } | null,
  conversation: Conversation,
  turn: Turn
): Promise<HandoffResult> {
  const at = new Date().toISOString();
  if (!turn.brief) return { ok: false, simulated: false, error: "This turn has no brief.", at };
  if (!hermes) return { ok: true, simulated: true, at };
  try {
    const res = await fetch(hermes.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(hermes.apiKey ? { Authorization: `Bearer ${hermes.apiKey}` } : {}) },
      body: JSON.stringify({
        schema_version: "3.0",
        conversation_id: conversation.id,
        turn_id: turn.id,
        objective: turn.prompt,
        council_answer: turn.synthesis?.text ?? "",
        mode: turn.mode,
        brief: turn.brief,
        execution_authorized: true
      }),
      signal: AbortSignal.timeout(20_000)
    });
    if (!res.ok) throw new Error(`Hermes returned HTTP ${res.status}`);
    return { ok: true, simulated: false, at };
  } catch (error) {
    return { ok: false, simulated: false, error: errorMessage(error), at };
  }
}
