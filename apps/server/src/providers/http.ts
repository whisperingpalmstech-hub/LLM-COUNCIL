import { ProviderError } from "./types.ts";

export interface FetchJsonOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
  label: string;
}

/** fetch + JSON with a timeout, caller cancellation, and classified errors. */
export async function fetchJson<T = any>(url: string, options: FetchJsonOptions): Promise<T> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method ?? "POST",
      headers: { "Content-Type": "application/json", ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const timedOut = timeout.aborted;
    throw new ProviderError(`${options.label}: ${timedOut ? `timed out after ${options.timeoutMs} ms` : errorMessage(error)}`, { retryable: true });
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new ProviderError(`${options.label} HTTP ${res.status}${detail ? `: ${detail}` : ""}`, {
      status: res.status,
      retryable: res.status === 429 || res.status >= 500
    });
  }
  return (await res.json()) as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Strip reasoning blocks some models (DeepSeek R1, Qwen) emit inline. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
