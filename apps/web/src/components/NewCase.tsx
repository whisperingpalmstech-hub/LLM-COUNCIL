import { Menu } from "lucide-react";
import { useState } from "react";
import { CASE_MODES, type CaseMode, type ServerInfo } from "@synod/contracts";
import { api, fileToBase64 } from "~/lib/api";
import { MODE_UI } from "~/lib/modes";
import { navigate } from "~/lib/router";
import { cn } from "~/lib/utils";
import { Composer } from "./Composer";
import { Button } from "./ui/button";

export function NewCase({ info, onOpenSidebar }: { info: ServerInfo | null; onOpenSidebar: () => void }) {
  const [mode, setMode] = useState<CaseMode>(() => (localStorage.getItem("synod.mode") as CaseMode) || "medical");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const ui = MODE_UI[mode];

  const choose = (m: CaseMode) => {
    setMode(m);
    localStorage.setItem("synod.mode", m);
  };

  const start = async () => {
    setSending(true);
    try {
      const conversation = await api.createConversation(mode);
      for (const file of files) await api.upload(conversation.id, { name: file.name, mimeType: file.type, data: await fileToBase64(file) });
      await api.send(conversation.id, text);
      navigate(`/c/${conversation.id}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="relative flex h-full flex-col overflow-y-auto">
      <Button variant="ghost-muted" size="icon" className="absolute top-2 left-2 md:hidden" onClick={onOpenSidebar} aria-label="Open sidebar">
        <Menu />
      </Button>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-16">
        <div className="rise-in text-center">
          <h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">Get a second opinion</h1>
          <p className="mx-auto mt-3 max-w-md text-balance text-muted-foreground">
            Several leading AI models work your case independently, critique each other anonymously, and agree on a brief you can act on.
          </p>
        </div>

        <div className="rise-in mt-8 grid grid-cols-2 gap-2 [animation-delay:60ms] sm:grid-cols-4" role="radiogroup" aria-label="Case type">
          {CASE_MODES.map((m) => {
            const u = MODE_UI[m];
            const Icon = u.icon;
            const selected = m === mode;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => choose(m)}
                className={cn(
                  "group cursor-pointer rounded-xl border p-3 text-left transition-[background-color,border-color,box-shadow]",
                  selected ? "border-primary/50 bg-card shadow-xs/5 ring-3 ring-primary/10" : "bg-transparent hover:bg-card"
                )}
              >
                <Icon className={cn("size-4.5", u.tint)} />
                <p className="mt-2 font-medium text-sm">{u.label}</p>
                <p className="mt-0.5 text-2xs text-muted-foreground leading-snug">{u.tagline}</p>
              </button>
            );
          })}
        </div>

        <div className="rise-in mt-4 [animation-delay:120ms]">
          <Composer
            size="hero"
            autoFocus
            value={text}
            onValueChange={setText}
            placeholder={ui.placeholder}
            busy={sending}
            files={files.map((f, i) => ({ id: String(i), name: f.name }))}
            onAttach={(added) => setFiles((cur) => [...cur, ...added])}
            onRemoveFile={(id) => setFiles((cur) => cur.filter((_, i) => String(i) !== id))}
            voice={Boolean(info?.voice.available)}
            onSend={start}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
            <button type="button" className="cursor-pointer text-left underline-offset-4 hover:text-foreground hover:underline" onClick={() => setText(ui.example)}>
              Try an example {ui.label.toLowerCase()} case →
            </button>
            {(mode === "medical" || mode === "legal") && <span>Test build: don't enter real patient or client identifiers.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
