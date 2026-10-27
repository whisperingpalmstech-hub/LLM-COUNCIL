import { Crown, Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { CASE_MODES, type CaseMode, type CouncilConfig, type ServerInfo } from "@synod/contracts";
import { api, fileToBase64 } from "~/lib/api";
import { useAuth } from "~/lib/auth";
import { MODE_UI } from "~/lib/modes";
import { navigate } from "~/lib/router";
import { cn } from "~/lib/utils";
import { Composer } from "./Composer";
import { ModelLogo } from "./ModelLogo";
import { Button } from "./ui/button";

export function NewCase({ info, onOpenSidebar }: { info: ServerInfo | null; onOpenSidebar: () => void }) {
  const auth = useAuth();
  const [mode, setMode] = useState<CaseMode>(() => (localStorage.getItem("synod.mode") as CaseMode) || "medical");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [council, setCouncil] = useState<CouncilConfig | null>(null);
  const ui = MODE_UI[mode];
  const firstName = auth.status === "signed-in" ? auth.user.name.split(/\s+/)[0] : "";

  useEffect(() => {
    api.council().then(setCouncil, () => undefined);
  }, []);

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
        {council && (
          <div className="flex justify-center">
            <div className="flex items-end gap-3">
              {council.members.map((m, i) => (
                <span key={m.id} className="reveal flex flex-col items-center gap-1.5" style={{ "--i": i } as React.CSSProperties} title={m.label}>
                  <span className="flex size-10 items-center justify-center rounded-full border bg-card shadow-[var(--shadow-raised)]">
                    <ModelLogo member={m} className="size-5" />
                  </span>
                </span>
              ))}
              <span className="reveal ml-1 flex flex-col items-center" style={{ "--i": council.members.length } as React.CSSProperties} title={`Chairman: ${council.chairman.label}`}>
                <span className="relative flex size-10 items-center justify-center rounded-full border border-amber-500/40 bg-card shadow-[var(--shadow-raised)]">
                  <Crown className="absolute -top-2 size-3.5 fill-amber-400 text-amber-500" />
                  <ModelLogo member={council.chairman} className="size-5" />
                </span>
              </span>
            </div>
          </div>
        )}

        <h1 className="mt-7 text-center font-semibold text-[1.9rem] tracking-[-0.025em] sm:text-[2.25rem]">{firstName ? `What's the case, ${firstName}?` : "What's the case?"}</h1>
        <p className="mx-auto mt-2 max-w-md text-balance text-center text-muted-foreground">
          {council ? `${council.members.length} models will work it independently, review each other blind, and agree on a brief.` : "The council will work it independently, review each other blind, and agree on a brief."}
        </p>

        <div className="mt-8 flex justify-center">
          <div className="inline-flex rounded-xl bg-muted p-1" role="radiogroup" aria-label="Case type">
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
                    "flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 font-medium text-sm transition-[background-color,color,box-shadow] duration-150",
                    selected ? "bg-card text-foreground shadow-[0_1px_3px_rgb(0_0_0/10%)]" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className={cn("size-3.5", selected && u.tint)} />
                  {u.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
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
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-2 text-muted-foreground text-xs">
            <span>
              {ui.tagline}.{" "}
              <button type="button" className="cursor-pointer font-medium text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground" onClick={() => setText(ui.example)}>
                Try an example
              </button>
            </span>
            {(mode === "medical" || mode === "legal") && <span>Don't include identifiable patient or client details.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
