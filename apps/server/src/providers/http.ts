import { ProviderError } from "./types.ts";

export interface FetchJsonOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
  label: string;
}

/** fetch with a timeout, caller cancellation, and classified errors. Returns the OK response. */
export async function fetchOk(url: string, options: FetchJsonOptions): Promise<{ res: Response; signal: AbortSignal; timeout: AbortSignal }> {
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
    throw classify(error, options, timeout);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new ProviderError(`${options.label} HTTP ${res.status}${detail ? `: ${detail}` : ""}`, {
      status: res.status,
      retryable: res.status === 429 || res.status >= 500
    });
  }
  return { res, signal, timeout };
}

/** fetch + JSON body. */
export async function fetchJson<T = any>(url: string, options: FetchJsonOptions): Promise<T> {
  const { res, timeout } = await fetchOk(url, options);
  try {
    return (await res.json()) as T;
  } catch (error) {
    throw classify(error, options, timeout);
  }
}

/**
 * POST and read a server-sent-events stream, calling `onData` with each `data:` payload
 * (JSON-parsed when possible). Stops at `[DONE]`.
 */
export async function fetchSse(url: string, options: FetchJsonOptions, onData: (data: any) => void): Promise<void> {
  const { res, timeout } = await fetchOk(url, { ...options, headers: { Accept: "text/event-stream", ...options.headers } });
  if (!res.body) throw new ProviderError(`${options.label}: empty stream`, { retryable: true });
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        let data: unknown;
        try {
          data = JSON.parse(payload);
        } catch {
          continue; // keep-alives and non-JSON lines
        }
        onData(data);
      }
    }
  } catch (error) {
    throw classify(error, options, timeout);
  }
}

function classify(error: unknown, options: FetchJsonOptions, timeout: AbortSignal): unknown {
  if (options.signal?.aborted) return error;
  if (error instanceof ProviderError) return error;
  return new ProviderError(`${options.label}: ${timeout.aborted ? `timed out after ${options.timeoutMs} ms` : errorMessage(error)}`, { retryable: true });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Strip reasoning blocks some models (DeepSeek R1, Qwen) emit inline. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
