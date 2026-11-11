// Knowledge bases: files, links, and AnythingLLM workspaces the council draws on.
import { FileText, Globe, Library, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AddKnowledgeBaseRequest, KnowledgeBase } from "@synod/contracts";
import { api, fileToBase64 } from "~/lib/api";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { SectionTitle, Spinner } from "./ui/misc";

const field = "h-9 w-full min-w-0 rounded-xl border border-border-strong bg-card px-3 text-sm outline-none transition-shadow focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ring)_12%,transparent)]";

const KINDS = [
  { id: "file", label: "File", icon: FileText, hint: "Text, Markdown, PDF, or Word, up to 10 MB" },
  { id: "link", label: "Web link", icon: Globe, hint: "A page whose text is saved and searched" },
  { id: "anythingllm", label: "AnythingLLM", icon: Library, hint: "A workspace, queried live for each question" }
] as const;
type Kind = (typeof KINDS)[number]["id"];

export function KnowledgeSettings() {
  const [bases, setBases] = useState<KnowledgeBase[] | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.knowledge().then(setBases, (e) => setError(e.message));
  }, []);

  const add = async (make: () => Promise<AddKnowledgeBaseRequest[]>) => {
    setBusy(true);
    setError(null);
    try {
      for (const body of await make()) {
        const added = await api.addKnowledge(body);
        setBases((list) => [...(list ?? []), added]);
      }
      setKind(null);
      setUrl("");
      setName("");
      setApiKey("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const addFiles = (files: File[]) =>
    add(() => Promise.all(files.map(async (f) => ({ kind: "file" as const, fileName: f.name, mimeType: f.type, data: await fileToBase64(f) }))));

  const toggle = async (kb: KnowledgeBase) => {
    setBases((list) => (list ?? []).map((k) => (k.id === kb.id ? { ...k, enabled: !k.enabled } : k)));
    await api.updateKnowledge(kb.id, { enabled: !kb.enabled }).catch((e) => setError((e as Error).message));
  };
  const remove = async (kb: KnowledgeBase) => {
    setBases((list) => (list ?? []).filter((k) => k.id !== kb.id));
    await api.removeKnowledge(kb.id).catch((e) => setError((e as Error).message));
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SectionTitle>Knowledge bases</SectionTitle>
        <p className="mt-0.5 text-muted-foreground text-xs">Your own material. The panel is given the most relevant passages in every debate and council case, and says when it uses them.</p>
        {!bases ? (
          <p className="mt-3 text-muted-foreground text-sm">{error ?? "Loading…"}</p>
        ) : bases.length ? (
          <ul className="mt-3 divide-y rounded-2xl border">
            {bases.map((kb) => {
              const Icon = KINDS.find((k) => k.id === kb.kind)?.icon ?? FileText;
              return (
                <li key={kb.id} className="fade-in flex items-center gap-3 px-3.5 py-2.5">
                  <Icon className={cn("size-4 shrink-0", kb.enabled ? "text-foreground" : "text-faint")} />
                  <span className={cn("min-w-0 flex-1 transition-opacity", !kb.enabled && "opacity-55")}>
                    <span className="block truncate font-medium text-sm">{kb.name}</span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {kb.detail}
                      {kb.chars ? ` · ${kb.chars > 5000 ? `${Math.round(kb.chars / 1000)}k characters, searched` : "short, always included"}` : kb.kind === "anythingllm" ? " · queried live" : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={kb.enabled}
                    aria-label={`Use ${kb.name}`}
                    title={kb.enabled ? "In use" : "Not in use"}
                    onClick={() => toggle(kb)}
                    className={cn("relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors", kb.enabled ? "bg-primary" : "bg-input")}
                  >
                    <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform", kb.enabled && "translate-x-4")} />
                  </button>
                  <Button variant="ghost-muted" size="icon-sm" onClick={() => remove(kb)} aria-label={`Remove ${kb.name}`}>
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 rounded-2xl border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">Nothing yet. Add a file, a link, or an AnythingLLM workspace below.</p>
        )}
      </div>

      <div>
        <SectionTitle icon={<Plus />}>Add a source</SectionTitle>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => (setKind(kind === k.id ? null : k.id), setError(null))}
              className={cn(
                "cursor-pointer rounded-2xl border p-3 text-left transition-[background-color,border-color,box-shadow,scale] duration-150 active:scale-[0.98]",
                kind === k.id ? "border-ring/50 shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring)_12%,transparent)]" : "hover:bg-accent"
              )}
            >
              <k.icon className="size-4 text-muted-foreground" />
              <p className="mt-2 font-medium text-sm">{k.label}</p>
              <p className="text-muted-foreground text-xs">{k.hint}</p>
            </button>
          ))}
        </div>

        {kind === "file" && (
          <div
            className={cn("fade-in mt-3 flex flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-6 text-center transition-colors", dragging && "border-accent-brand bg-accent")}
            onDragOver={(e) => (e.preventDefault(), setDragging(true))}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void addFiles([...e.dataTransfer.files]);
            }}
          >
            <input ref={picker} type="file" multiple hidden accept=".txt,.md,.markdown,.pdf,.docx,.csv,.json,.html,text/*,application/pdf" onChange={(e) => (void addFiles([...(e.target.files ?? [])]), (e.target.value = ""))} />
            <Button variant="outline" disabled={busy} onClick={() => picker.current?.click()}>
              {busy ? <Spinner /> : <Upload />} Choose files
            </Button>
            <p className="text-muted-foreground text-xs">or drop them here</p>
          </div>
        )}
        {kind === "link" && (
          <form className="fade-in mt-3 flex gap-2" onSubmit={(e) => (e.preventDefault(), void add(async () => [{ kind: "link", url }]))}>
            <input className={field} type="url" required autoFocus placeholder="https://example.com/guideline" value={url} onChange={(e) => setUrl(e.target.value)} />
            <Button type="submit" disabled={busy || !url.trim()}>
              {busy && <Spinner />} Add
            </Button>
          </form>
        )}
        {kind === "anythingllm" && (
          <form className="fade-in mt-3 flex flex-col gap-2" onSubmit={(e) => (e.preventDefault(), void add(async () => [{ kind: "anythingllm", url, workspace: name, apiKey }]))}>
            <input className={field} required autoFocus placeholder="Workspace link, e.g. http://localhost:3001/workspace/my-notes" value={url} onChange={(e) => setUrl(e.target.value)} />
            <div className="grid gap-2 sm:grid-cols-2">
              <input className={field} placeholder="Workspace name (if not in the link)" value={name} onChange={(e) => setName(e.target.value)} />
              <input className={field} type="password" autoComplete="off" placeholder="API key (blank uses the server's)" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </div>
            <div className="flex items-center gap-3">
              <p className="flex-1 text-faint text-xs">Create a key in AnythingLLM under Settings → Developer API. It stays on this server.</p>
              <Button type="submit" disabled={busy || !url.trim()}>
                {busy && <Spinner />} Connect
              </Button>
            </div>
          </form>
        )}
        {error && bases && <p className="mt-2 text-error-foreground text-xs">{error}</p>}
      </div>
    </div>
  );
}
