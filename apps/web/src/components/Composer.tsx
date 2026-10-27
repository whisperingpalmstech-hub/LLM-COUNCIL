import { Popover } from "@base-ui/react/popover";
import { ArrowUp, FileText, Loader2, Mic, Paperclip, Smartphone, Square, X } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api } from "~/lib/api";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";

export interface ComposerFile {
  id: string;
  name: string;
  readable?: boolean;
}

export function Composer({
  placeholder,
  disabled,
  busy,
  files,
  voice,
  phoneLink,
  autoFocus,
  footer,
  value,
  onValueChange,
  onAttach,
  onRemoveFile,
  onSend,
  onStop,
  size = "default"
}: {
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  files: ComposerFile[];
  voice: boolean;
  /** Returns a signed link a phone can use to add files to this case. */
  phoneLink?: () => Promise<string>;
  autoFocus?: boolean;
  footer?: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  onAttach: (files: File[]) => void | Promise<void>;
  onRemoveFile?: (id: string) => void;
  onSend: () => void | Promise<void>;
  onStop?: () => void;
  size?: "default" | "hero";
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const canSend = value.trim().length > 0 && !disabled && !busy;

  // Grow with content up to a cap, like T3's composer.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, size === "hero" ? 360 : 280)}px`;
  }, [value, size]);

  useEffect(() => {
    if (autoFocus) textarea.current?.focus();
  }, [autoFocus]);

  const send = async () => {
    if (!canSend) return;
    setError(null);
    try {
      await onSend();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const attach = async (list: FileList | File[] | null) => {
    const items = Array.from(list ?? []);
    if (!items.length) return;
    setError(null);
    try {
      await onAttach(items);
    } catch (e) {
      setError((e as Error).message);
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  return (
    <div className="w-full">
      <div
        className={cn(
          "relative rounded-3xl border border-border-strong bg-card shadow-[var(--shadow-raised)] transition-[border-color,box-shadow] duration-200 ease-out focus-within:border-ring/50 focus-within:shadow-[var(--shadow-raised),0_0_0_4px_color-mix(in_srgb,var(--ring)_12%,transparent)]",
          dragging && "border-ring shadow-[0_0_0_4px_color-mix(in_srgb,var(--ring)_18%,transparent)]"
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void attach(e.dataTransfer.files);
        }}
      >
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {files.map((f) => (
              <span key={f.id} className="fade-in inline-flex max-w-56 items-center gap-1.5 rounded-full bg-muted py-1 pr-1.5 pl-2.5 text-xs" title={f.readable === false ? "The council can't read this file's contents as text" : undefined}>
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{f.name}</span>
                {onRemoveFile && (
                  <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => onRemoveFile(f.id)} aria-label={`Remove ${f.name}`}>
                    <X className="size-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textarea}
          value={value}
          rows={size === "hero" ? 4 : 2}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              void attach(e.clipboardData.files);
            }
          }}
          className={cn(
            "block w-full resize-none bg-transparent px-5 pt-4 text-[0.9375rem] leading-relaxed outline-none placeholder:text-faint disabled:cursor-not-allowed",
            size === "hero" ? "min-h-28" : "min-h-14"
          )}
        />
        <div className="flex items-center gap-0.5 px-2.5 pt-1 pb-2.5">
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => attach(e.target.files)} />
          <Button variant="ghost-muted" size="icon-sm" onClick={() => fileInput.current?.click()} title="Attach files (or drop / paste)" aria-label="Attach files">
            <Paperclip />
          </Button>
          {voice && <VoiceButton onText={(t) => onValueChange(value ? `${value.trimEnd()} ${t}` : t)} onError={setError} />}
          {phoneLink && <PhoneButton getUrl={phoneLink} />}
          <div className="ml-auto flex items-center gap-2">
            {footer}
            {busy && onStop ? (
              <Button variant="outline" size="icon" className="rounded-full" onClick={onStop} title="Stop the council" aria-label="Stop">
                <Square className="size-3 fill-current" />
              </Button>
            ) : (
              <Button size="icon" className="rounded-full" disabled={!canSend} onClick={send} aria-label="Send" title="Send (Enter)">
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
      </div>
      {error && <p className="mt-2 px-1 text-error-foreground text-xs">{error}</p>}
    </div>
  );
}

function VoiceButton({ onText, onError }: { onText: (text: string) => void; onError: (message: string) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    if (state !== "recording") return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState("transcribing");
        try {
          const { text } = await api.transcribe(new Blob(chunks, { type: rec.mimeType || "audio/webm" }), navigator.language.slice(0, 2));
          onText(text);
        } catch (e) {
          onError((e as Error).message);
        } finally {
          setState("idle");
        }
      };
      rec.start();
      recorder.current = rec;
      setState("recording");
    } catch (e) {
      onError(`Microphone unavailable: ${(e as Error).message}`);
    }
  };

  if (state === "recording")
    return (
      <Button variant="outline" size="sm" className="border-error/40 text-error-foreground" onClick={() => recorder.current?.stop()} title="Stop dictation">
        <span className="size-2 animate-pulse rounded-full bg-error" />
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
      </Button>
    );
  return (
    <Button variant="ghost-muted" size="icon-sm" disabled={state === "transcribing"} onClick={start} title="Dictate" aria-label="Dictate">
      {state === "transcribing" ? <Loader2 className="animate-spin" /> : <Mic />}
    </Button>
  );
}

function PhoneButton({ getUrl }: { getUrl: () => Promise<string> }) {
  const [qr, setQr] = useState<string | null>(null);
  return (
    <Popover.Root onOpenChange={(open) => open && !qr && getUrl().then((url) => QRCode.toDataURL(url, { margin: 1, width: 200 })).then(setQr, () => undefined)}>
      <Popover.Trigger render={<Button variant="ghost-muted" size="icon-sm" title="Add files from your phone" aria-label="Add files from your phone" />}>
        <Smartphone />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} className="z-50">
          <Popover.Popup className="w-64 origin-[var(--transform-origin)] rounded-2xl border bg-popover p-4 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.25)] transition-[opacity,scale] duration-200 ease-[var(--ease-out)] data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:duration-150 data-starting-style:scale-[0.96] data-starting-style:opacity-0">
            <p className="font-medium text-sm">Add from your phone</p>
            <p className="mt-0.5 text-muted-foreground text-xs">Scan to send photos, scans, or notes into this case. The link works for 12 hours.</p>
            <div className="mt-3 flex justify-center rounded-lg bg-white p-2">{qr ? <img src={qr} alt="QR code" width={200} height={200} /> : <div className="size-[200px]" />}</div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
