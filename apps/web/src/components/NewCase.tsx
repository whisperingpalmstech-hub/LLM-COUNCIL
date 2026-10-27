import { Crown, Menu, MessagesSquare, Scale as Gavel, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { CASE_MODES, type CaseMode, type CouncilConfig, type CouncilMember, type Depth, type ServerInfo } from "@synod/contracts";
import { api, fileToBase64 } from "~/lib/api";
import { useAuth } from "~/lib/auth";
import { MODE_UI } from "~/lib/modes";
import { navigate } from "~/lib/router";
import { cn, firstName } from "~/lib/utils";
import { Composer } from "./Composer";
import { DepthPicker } from "./DepthPicker";
import { memberMentions, newCaseCommands } from "~/lib/commands";
import { ModelLogo } from "./ModelLogo";
import { Button } from "./ui/button";

export function NewCase({ info, onOpenSidebar }: { info: ServerInfo | null; onOpenSidebar: () => void }) {
  const auth = useAuth();
  const [mode, setMode] = useState<CaseMode | "auto">(() => (localStorage.getItem("synod.mode") as CaseMode | "auto") || "auto");
  const [depth, setDepth] = useState<Depth | null>(null);
  const [kind, setKind] = useState<"council" | "chat">(() => (localStorage.getItem("synod.kind") as "council" | "chat") || "council");
  const [recipes, setRecipes] = useState<Awaited<ReturnType<typeof api.recipes>> | null>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [council, setCouncil] = useState<CouncilConfig | null>(null);
  const ui = MODE_UI[mode === "auto" ? "general" : mode];
  const greetName = auth.status === "signed-in" ? firstName(auth.user.name) : "";

  useEffect(() => {
    api.council().then(setCouncil, () => undefined);
    api.recipes().then(setRecipes, () => undefined);
  }, []);

  // Who will sit on this case: the recommended council for its type, unless the user chose their own.
  const seats: { members: CouncilMember[]; chairman: CouncilMember } | null = council
    ? council.auto && recipes?.available
      ? recipes.recipes[mode === "auto" ? "general" : mode]
      : council
    : null;
  const effectiveDepth: Depth = depth ?? council?.depth ?? "standard";

  const choose = (m: CaseMode | "auto") => {
    setMode(m);
    localStorage.setItem("synod.mode", m);
  };

  const start = async () => {
    setSending(true);
    try {
      const conversation = await api.createConversation(mode, kind);
      if (kind === "chat") {
        await api.chat(conversation.id, text);
      } else {
        for (const file of files) await api.upload(conversation.id, { name: file.name, mimeType: file.type, data: await fileToBase64(file) });
        await api.send(conversation.id, text, { depth: effectiveDepth });
      }
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
        {seats && (
          <div className="flex justify-center">
            <div key={mode} className="flex items-end gap-3">
              {seats.members.map((m, i) => (
                <span key={m.id} className="reveal flex flex-col items-center gap-1.5" style={{ "--i": i } as React.CSSProperties} title={m.label}>
                  <span className="flex size-10 items-center justify-center rounded-full border bg-card shadow-[var(--shadow-raised)]">
                    <ModelLogo member={m} className="size-5" />
                  </span>
                </span>
              ))}
              <span className="reveal ml-1 flex flex-col items-center" style={{ "--i": seats.members.length } as React.CSSProperties} title={`Chairman: ${seats.chairman.label}`}>
                <span className="relative flex size-10 items-center justify-center rounded-full border border-amber-500/40 bg-card shadow-[var(--shadow-raised)]">
                  <Crown className="absolute -top-2 size-3.5 fill-amber-400 text-amber-500" />
                  <ModelLogo member={seats.chairman} className="size-5" />
                </span>
              </span>
            </div>
          </div>
        )}

        <div className="mt-7 flex justify-center">
          <div className="inline-flex rounded-full border bg-card p-0.5 text-sm shadow-[0_1px_2px_rgb(0_0_0/4%)]" role="radiogroup" aria-label="How to work">
            {(
              [
                ["council", "Get an opinion", Gavel],
                ["chat", "Discuss", MessagesSquare]
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={kind === value}
                onClick={() => {
                  setKind(value);
                  localStorage.setItem("synod.kind", value);
                }}
                className={cn("flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3.5 font-medium transition-[background-color,color] duration-150", kind === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <h1 className="mt-5 text-center font-semibold text-[1.9rem] tracking-[-0.025em] sm:text-[2.25rem]">{greetName ? `What's the case, ${greetName}?` : "What's the case?"}</h1>
        <p className="mx-auto mt-2 max-w-md text-balance text-center text-muted-foreground">
          {kind === "chat"
            ? "Talk it through with the panel. A moderator lets the right models answer, and they'll challenge each other."
            : seats
              ? `${seats.members.length} leading models will work it independently, review each other blind, and agree on a brief.`
              : "The council will work it independently, review each other blind, and agree on a brief."}
        </p>

        <div className="mt-8 flex justify-center">
          <div className="inline-flex rounded-xl bg-muted p-1" role="radiogroup" aria-label="Case type">
            {(["auto", ...CASE_MODES] as const).map((m) => {
              const u = m === "auto" ? { label: "Auto", icon: Wand2, tint: "text-accent-brand" } : MODE_UI[m];
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
            footer={kind === "council" ? <DepthPicker value={effectiveDepth} onChange={setDepth} /> : undefined}
            mentions={kind === "chat" && seats ? memberMentions(seats.members) : []}
            commands={newCaseCommands({
              setKind: (k) => {
                setKind(k);
                localStorage.setItem("synod.kind", k);
              },
              setMode: choose,
              setDepth
            })}
            onSend={start}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-2 text-muted-foreground text-xs">
            <span>
              {mode === "auto" ? "Synod picks the right specialists for the case." : `${ui.tagline}.`}{" "}
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
