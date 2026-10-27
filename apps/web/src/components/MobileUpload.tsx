import { Camera, Check, FileUp, Loader2, X } from "lucide-react";
import { useState } from "react";
import { api, fileToBase64 } from "~/lib/api";
import { Logo } from "./Sidebar";
import { Button } from "./ui/button";

/** Phone page reached via the QR code: add photos, scans, files, or a note to a case. */
export function MobileUpload({ conversationId }: { conversationId: string }) {
  const [log, setLog] = useState<{ ok: boolean; text: string }[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const add = (ok: boolean, text: string) => setLog((l) => [{ ok, text }, ...l]);

  const sendFiles = async (files: FileList | null) => {
    setBusy(true);
    for (const file of Array.from(files ?? [])) {
      try {
        await api.upload(conversationId, { name: file.name, mimeType: file.type, data: await fileToBase64(file), source: "mobile" });
        add(true, file.name);
      } catch (e) {
        add(false, `${file.name}: ${(e as Error).message}`);
      }
    }
    setBusy(false);
  };

  const sendNote = async () => {
    setBusy(true);
    try {
      const data = btoa(String.fromCharCode(...new TextEncoder().encode(note)));
      await api.upload(conversationId, { name: `note-${new Date().toTimeString().slice(0, 8)}.txt`, mimeType: "text/plain", data, source: "mobile" });
      add(true, "Note");
      setNote("");
    } catch (e) {
      add(false, `Note: ${(e as Error).message}`);
    }
    setBusy(false);
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-5 py-8">
      <div className="flex items-center gap-2 font-semibold">
        <Logo /> Synod
      </div>
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">Add to your case</h1>
        <p className="mt-1 text-muted-foreground text-sm">Everything you send appears in the case open on your computer, ready for the council.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border bg-card p-5 text-sm">
          <Camera className="size-6 text-primary" />
          Take photo
          <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={(e) => sendFiles(e.target.files)} />
        </label>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border bg-card p-5 text-sm">
          <FileUp className="size-6 text-primary" />
          Choose files
          <input type="file" multiple hidden disabled={busy} onChange={(e) => sendFiles(e.target.files)} />
        </label>
      </div>
      <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="…or type a note" className="rounded-2xl border bg-card p-3 text-[0.9375rem] outline-none focus:border-ring/60" />
      <Button size="lg" disabled={busy || !note.trim()} onClick={sendNote}>
        {busy ? <Loader2 className="animate-spin" /> : null} Send note
      </Button>
      <ul className="flex flex-col gap-1.5 text-sm">
        {log.map((l, i) => (
          <li key={i} className="flex items-center gap-2">
            {l.ok ? <Check className="size-4 text-success" /> : <X className="size-4 text-error" />}
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
