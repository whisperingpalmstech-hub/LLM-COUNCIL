import { useState } from "react";
import { api, fileToBase64 } from "../lib/api";

/** Phone-sized page reached via the QR code: send photos, files, or a note into a conversation. */
export function MobileUpload({ conversationId }: { conversationId: string }) {
  const [status, setStatus] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const log = (line: string) => setStatus((s) => [line, ...s]);

  const sendFiles = async (files: FileList | null) => {
    setBusy(true);
    for (const file of Array.from(files ?? [])) {
      try {
        await api.upload(conversationId, { name: file.name, mimeType: file.type, data: await fileToBase64(file), source: "mobile" });
        log(`✓ ${file.name}`);
      } catch (e) {
        log(`✗ ${file.name}: ${(e as Error).message}`);
      }
    }
    setBusy(false);
  };

  const sendNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      const data = btoa(unescape(encodeURIComponent(note)));
      await api.upload(conversationId, { name: `note-${new Date().toISOString().slice(11, 19)}.txt`, mimeType: "text/plain", data, source: "mobile" });
      log("✓ Note sent");
      setNote("");
    } catch (e) {
      log(`✗ Note: ${(e as Error).message}`);
    }
    setBusy(false);
  };

  return (
    <div className="mobile">
      <h1>Synod</h1>
      <p className="muted">Anything you send here is attached to the conversation open on your computer, ready for your next question.</p>
      <label className="button primary wide">
        Take photo or choose files
        <input type="file" multiple accept="image/*,application/pdf,text/*,.md,.csv,.json" hidden disabled={busy} onChange={(e) => sendFiles(e.target.files)} />
      </label>
      <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="…or type a note" />
      <button className="wide" disabled={busy || !note.trim()} onClick={sendNote}>
        Send note
      </button>
      <ul className="mobile-log">
        {status.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}
