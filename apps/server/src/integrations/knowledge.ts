// Knowledge bases: sources a user adds once and the council draws on in every case.
// Files and links are held as text and searched by keyword; AnythingLLM workspaces are queried live.

import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import type { AddKnowledgeBaseRequest, KnowledgeBase, SearchResult } from "@synod/contracts";
import type { Settings } from "../db/database.ts";
import { errorMessage, fetchJson } from "../providers/http.ts";
import { extract, guessType } from "./attachments.ts";

const MAX_BASES = 30;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 600_000;
const CHUNK_CHARS = 1100;
/** A source this small is given to the council whole instead of searched. */
const SMALL_SOURCE_CHARS = 5000;

interface Stored extends KnowledgeBase {
  ownerId: string;
  /** link: the page; anythingllm: the server's base URL. */
  url?: string;
  workspace?: string;
  apiKey?: string;
}

export interface KnowledgeOptions {
  env?: Record<string, string | undefined>;
  /** Allow links to private addresses (tests). */
  allowPrivate?: boolean;
}

export class KnowledgeStore {
  private readonly settings: Settings;
  private readonly dir: string;
  private readonly options: KnowledgeOptions;
  private readonly chunks = new Map<string, string[]>();

  constructor(settings: Settings, dataDir: string, options: KnowledgeOptions = {}) {
    this.settings = settings;
    this.dir = path.join(dataDir, "knowledge");
    this.options = options;
  }

  list(userId: string): KnowledgeBase[] {
    return this.stored(userId).map(toPublic);
  }

  async add(user: { id: string; admin: boolean }, request: AddKnowledgeBaseRequest): Promise<KnowledgeBase> {
    const all = this.stored(user.id);
    if (all.length >= MAX_BASES) throw bad(`You can keep up to ${MAX_BASES} knowledge bases. Remove one first.`);
    const id = crypto.randomUUID();
    const base = { id, ownerId: user.id, enabled: true, createdAt: new Date().toISOString() };
    let entry: Stored;
    if (request.kind === "file") {
      const buffer = Buffer.from(String(request.data ?? ""), "base64");
      if (!buffer.length) throw bad("File is empty.");
      if (buffer.length > MAX_FILE_BYTES) throw Object.assign(new Error("File exceeds the 10 MB limit."), { status: 413 });
      const fileName = path.basename(String(request.fileName || "file")).slice(0, 120);
      const { text } = await extract(buffer, request.mimeType || guessType(fileName), fileName);
      if (!text.trim()) throw bad("Couldn't read any text from that file. Text, Markdown, PDF, and Word files work.");
      const chars = await this.writeText(id, text);
      entry = { ...base, kind: "file", name: clean(request.name) || fileName, detail: fileName, chars };
    } else if (request.kind === "link") {
      const url = await this.checkUrl(request.url, false);
      const { text, title } = await this.fetchPage(url);
      if (!text.trim()) throw bad("That page has no readable text.");
      const chars = await this.writeText(id, text);
      entry = { ...base, kind: "link", name: clean(request.name) || title || new URL(url).hostname, detail: url, url, chars };
    } else if (request.kind === "anythingllm") {
      const parsed = parseWorkspaceLink(String(request.url ?? ""), request.workspace);
      if (!parsed.workspace) throw bad("Add the workspace: paste its link (…/workspace/your-workspace) or type its name.");
      await this.checkUrl(parsed.baseUrl, user.admin);
      const apiKey = clean(request.apiKey, 400) || this.options.env?.ANYTHINGLLM_API_KEY || "";
      if (!apiKey) throw bad("An AnythingLLM API key is needed (create one in AnythingLLM under Settings → Developer API).");
      let found: any;
      try {
        found = await fetchJson(`${parsed.baseUrl}/api/v1/workspace/${encodeURIComponent(parsed.workspace)}`, { method: "GET", label: "anythingllm", timeoutMs: 10_000, headers: { Authorization: `Bearer ${apiKey}` } });
      } catch (error) {
        const message = errorMessage(error);
        throw bad(/HTTP 40[13]/.test(message) ? "AnythingLLM rejected that API key." : `Couldn't reach AnythingLLM at ${new URL(parsed.baseUrl).host}: ${message.slice(0, 140)}`);
      }
      const workspace = Array.isArray(found?.workspace) ? found.workspace[0] : found?.workspace;
      if (!workspace?.slug) throw bad(`AnythingLLM has no workspace called "${parsed.workspace}". Use the name from the workspace's link.`);
      entry = { ...base, kind: "anythingllm", name: clean(request.name) || clean(workspace.name) || workspace.slug, detail: `${workspace.slug} on ${new URL(parsed.baseUrl).host}`, url: parsed.baseUrl, workspace: workspace.slug, apiKey };
    } else {
      throw bad("Unknown knowledge base type.");
    }
    this.save(user.id, [...all, entry]);
    return toPublic(entry);
  }

  update(userId: string, id: string, patch: { enabled?: unknown; name?: unknown }): KnowledgeBase {
    const all = this.stored(userId);
    const entry = all.find((k) => k.id === id);
    if (!entry) throw Object.assign(new Error("Knowledge base not found."), { status: 404 });
    if (typeof patch.enabled === "boolean") entry.enabled = patch.enabled;
    if (typeof patch.name === "string" && clean(patch.name)) entry.name = clean(patch.name);
    this.save(userId, all);
    return toPublic(entry);
  }

  async remove(userId: string, id: string): Promise<void> {
    const all = this.stored(userId);
    if (!all.some((k) => k.id === id)) throw Object.assign(new Error("Knowledge base not found."), { status: 404 });
    this.save(userId, all.filter((k) => k.id !== id));
    this.chunks.delete(id);
    await fs.rm(this.file(id), { force: true });
  }

  /** The passages most relevant to `query` across a user's enabled knowledge bases. */
  async search(userId: string | undefined, query: string, signal?: AbortSignal, limit = 5): Promise<SearchResult[]> {
    if (!userId) return [];
    const bases = this.stored(userId).filter((k) => k.enabled);
    if (!bases.length) return [];
    const local: { base: Stored; text: string; score: number }[] = [];
    const whole: SearchResult[] = [];
    const remote: Promise<SearchResult[]>[] = [];
    const terms = tokens(query);
    for (const base of bases) {
      if (base.kind === "anythingllm") {
        remote.push(this.queryWorkspace(base, query, signal).catch((error) => (console.warn(`[knowledge] ${base.name}:`, errorMessage(error)), [])));
        continue;
      }
      const chunks = await this.load(base.id);
      if ((base.chars ?? 0) <= SMALL_SOURCE_CHARS) {
        if (chunks.length) whole.push(result(base, chunks.join("\n\n")));
        continue;
      }
      for (const scored of rank(chunks, terms)) local.push({ base, ...scored });
    }
    const best = local.sort((a, b) => b.score - a.score).slice(0, limit).map((c) => result(c.base, c.text));
    const fromWorkspaces = (await Promise.all(remote)).flat();
    return [...whole, ...fromWorkspaces, ...best].slice(0, limit + whole.length);
  }

  private async queryWorkspace(base: Stored, query: string, signal?: AbortSignal): Promise<SearchResult[]> {
    const root = `${base.url}/api/v1/workspace/${encodeURIComponent(base.workspace ?? "")}`;
    const headers = { Authorization: `Bearer ${base.apiKey ?? ""}` };
    const q = query.slice(0, 1500);
    try {
      const data = await fetchJson(`${root}/vector-search`, { label: "anythingllm", timeoutMs: 15_000, signal, headers, body: { query: q, topN: 3 } });
      const hits = (Array.isArray(data.results) ? data.results : []).filter((r: any) => r?.text);
      if (hits.length) return hits.slice(0, 3).map((r: any) => result(base, String(r.text).slice(0, 1500), String(r.metadata?.title ?? "")));
    } catch {
      // Older AnythingLLM versions have no vector-search endpoint; ask the workspace instead.
    }
    const data = await fetchJson(`${root}/chat`, { label: "anythingllm", timeoutMs: 45_000, signal, headers, body: { message: q, mode: "query" } });
    const sources = (Array.isArray(data.sources) ? data.sources : []).filter((s: any) => s?.text).slice(0, 3);
    if (sources.length) return sources.map((s: any) => result(base, String(s.text).slice(0, 1500), String(s.title ?? "")));
    const answer = String(data.textResponse ?? "").trim();
    return answer ? [result(base, answer.slice(0, 1500))] : [];
  }

  private stored(userId: string): Stored[] {
    return this.settings.get<Stored[]>(`knowledge:${userId}`) ?? [];
  }

  private save(userId: string, all: Stored[]): void {
    this.settings.set(`knowledge:${userId}`, all);
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.txt`);
  }

  private async writeText(id: string, text: string): Promise<number> {
    const body = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT_CHARS);
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.file(id), body, { mode: 0o600 });
    return body.length;
  }

  private async load(id: string): Promise<string[]> {
    let chunks = this.chunks.get(id);
    if (!chunks) {
      const text = await fs.readFile(this.file(id), "utf8").catch(() => "");
      chunks = split(text);
      this.chunks.set(id, chunks);
    }
    return chunks;
  }

  /** Only http(s), and never an address inside the server's own network unless explicitly allowed. */
  private async checkUrl(input: string, allowPrivate: boolean): Promise<string> {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
    } catch {
      throw bad("That doesn't look like a valid link.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw bad("Only http and https links are supported.");
    if (allowPrivate || this.options.allowPrivate) return url.toString();
    const addresses = net.isIP(url.hostname) ? [{ address: url.hostname }] : await dns.lookup(url.hostname, { all: true }).catch(() => []);
    if (!addresses.length) throw bad("Couldn't find that address.");
    if (addresses.some((a) => isPrivate(a.address))) throw bad("That address is on a private network. Ask an administrator to add it.");
    return url.toString();
  }

  private async fetchPage(start: string): Promise<{ text: string; title: string }> {
    let url = start;
    for (let hop = 0; hop < 5; hop++) {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; knowledge-fetch)", Accept: "text/html,application/pdf,text/plain,*/*" } }).catch((error) => {
        throw bad(`Couldn't open that link: ${errorMessage(error).slice(0, 120)}`);
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        url = await this.checkUrl(new URL(res.headers.get("location")!, url).toString(), false);
        continue;
      }
      if (!res.ok) throw bad(`That link returned an error (HTTP ${res.status}).`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_FILE_BYTES) throw bad("That page is larger than 10 MB.");
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
      if (/html/.test(type) || (!type && /^\s*</.test(buffer.subarray(0, 200).toString("utf8")))) return htmlToText(buffer.toString("utf8"));
      const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "page");
      const { text } = await extract(buffer, type || guessType(name), name);
      return { text, title: name };
    }
    throw bad("That link redirects too many times.");
  }
}

function toPublic(k: Stored): KnowledgeBase {
  return { id: k.id, name: k.name, kind: k.kind, detail: k.detail, enabled: k.enabled, createdAt: k.createdAt, ...(k.chars ? { chars: k.chars } : {}), ...(k.error ? { error: k.error } : {}) };
}

function result(base: Stored, raw: string, part = ""): SearchResult {
  // AnythingLLM prefixes each chunk with a metadata block the panel doesn't need.
  const snippet = raw.replace(/<document_metadata>[\s\S]*?<\/document_metadata>\s*/g, "").trim();
  return { title: part && part !== base.name ? `${base.name}: ${part}` : base.name, url: base.kind === "link" ? (base.url ?? "") : "", snippet, source: "knowledge" };
}

/** Accepts "http://host:3001/workspace/my-notes", a bare server address plus a workspace name, or an API URL. */
export function parseWorkspaceLink(link: string, workspace?: string): { baseUrl: string; workspace: string } {
  const raw = link.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    throw bad("That doesn't look like a valid AnythingLLM link.");
  }
  const slug = url.pathname.match(/\/workspace\/([^/]+)/)?.[1];
  return { baseUrl: url.origin, workspace: clean(workspace) || (slug ? decodeURIComponent(slug) : "") };
}

export function htmlToText(html: string): { text: string; title: string } {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe|title|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decode(body).replace(/[ \t\f\v]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, title };
}

function decode(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return named[code.toLowerCase()] ?? whole;
  });
}

/** Split into passages on paragraph boundaries, around CHUNK_CHARS each. */
export function split(text: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const para of text.split(/\n{2,}/)) {
    const pieces = para.length > CHUNK_CHARS * 1.5 ? (para.match(new RegExp(`[\\s\\S]{1,${CHUNK_CHARS}}(?:\\s|$)`, "g")) ?? [para]) : [para];
    for (const piece of pieces) {
      if (current && current.length + piece.length > CHUNK_CHARS) {
        out.push(current.trim());
        current = "";
      }
      current += `${piece}\n\n`;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const STOP = new Set("the and for are but not you all any can had her was one our out has have this that with from they will what when your which their would there been were about into than then them these those some could should does just also over such only more most very much how who why whom whose its it's is in of to a an on at by or as be if do so we he she i it my me no yes up".split(" "));

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []).map((t) => t.replace(/'s$/, "")).filter((t) => t.length > 1 && !STOP.has(t));
}

/** BM25 over one source's passages. */
function rank(chunks: string[], query: string[]): { text: string; score: number }[] {
  const terms = [...new Set(query)];
  if (!terms.length || !chunks.length) return [];
  const docs = chunks.map((c) => tokens(c));
  const avg = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const term of terms) df.set(term, docs.filter((d) => d.includes(term)).length);
  return chunks
    .map((text, i) => {
      const doc = docs[i];
      let score = 0;
      for (const term of terms) {
        const n = df.get(term) ?? 0;
        if (!n) continue;
        const tf = doc.reduce((c, t) => c + (t === term ? 1 : 0), 0);
        if (!tf) continue;
        const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
        score += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * doc.length) / avg));
      }
      return { text, score };
    })
    .filter((c) => c.score > 0);
}

function isPrivate(address: string): boolean {
  if (net.isIPv6(address)) {
    const a = address.toLowerCase();
    if (a.startsWith("::ffff:")) return isPrivate(a.slice(7));
    return a === "::1" || a === "::" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe8") || a.startsWith("fe9") || a.startsWith("fea") || a.startsWith("feb");
  }
  const [a, b] = address.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

function clean(value: unknown, max = 80): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function bad(message: string): Error {
  return Object.assign(new Error(message), { status: 400 });
}
