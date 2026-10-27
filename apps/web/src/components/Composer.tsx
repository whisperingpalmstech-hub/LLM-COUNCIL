import { useRef, useState } from "react";
import QRCode from "qrcode";
import type { Conversation, ServerInfo } from "@synod/contracts";
import { api, fileToBase64 } from "../lib/api";

export function Composer({ conversation, disabled, info }: { conversation: Conversation; disabled: boolean; info: ServerInfo | null }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const send = async () => {
    const prompt = text.trim();
    if (!prompt || disabled || sending) return;
    setSending(true);
    setError(null);
    try {
      await api.send(conversation.id, prompt);
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const upload = async (files: FileList | null) => {
    setError(null);
    for (const file of Array.from(files ?? [])) {
      try {
        await api.upload(conversation.id, { name: file.name, mimeType: file.type, data: await fileToBase64(file) });
      } catch (e) {
        setError(`${file.name}: ${(e as Error).message}`);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  return (
    <div className="composer">
      {conversation.pendingAttachments.length > 0 && (
        <div className="chips">
          {conversation.pendingAttachments.map((a) => (
            <span key={a.id} className="chip" title={a.excerpt ? "Text will be shared with the council" : "Content not readable as text"}>
              📎 {a.name}
              {a.source === "mobile" && " (phone)"}
            </span>
          ))}
        </div>
      )}
      {error && <p className="warning small">{error}</p>}
      <div className="composer-box">
        <textarea
          value={text}
          rows={3}
          placeholder={disabled ? "The council is working…" : "Ask the council…  (Enter to send, Shift+Enter for a new line)"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              void upload(e.clipboardData.files);
            }
          }}
        />
        <div className="composer-actions">
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
          <button className="ghost" title="Attach files" onClick={() => fileInput.current?.click()}>
            📎
          </button>
          {info?.voice.available && <VoiceButton onText={(t) => setText((cur) => (cur ? `${cur} ${t}` : t))} onError={setError} />}
          <PhoneButton conversationId={conversation.id} baseUrl={info?.publicBaseUrl ?? null} />
          <button className="primary" onClick={send} disabled={disabled || sending || !text.trim()}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function VoiceButton({ onText, onError }: { onText: (text: string) => void; onError: (message: string) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const recorder = useRef<MediaRecorder | null>(null);

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
          const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
          const { text } = await api.transcribe(blob, navigator.language.slice(0, 2));
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

  return (
    <button
      className={`ghost ${state === "recording" ? "recording" : ""}`}
      title={state === "recording" ? "Stop recording" : "Dictate"}
      disabled={state === "transcribing"}
      onClick={() => (state === "recording" ? recorder.current?.stop() : start())}
    >
      {state === "transcribing" ? "…" : state === "recording" ? "■" : "🎙"}
    </button>
  );
}

function PhoneButton({ conversationId, baseUrl }: { conversationId: string; baseUrl: string | null }) {
  const [qr, setQr] = useState<string | null>(null);
  const url = `${baseUrl ?? location.origin}/mobile/${conversationId}`;
  return (
    <>
      <button
        className="ghost"
        title="Send files from your phone"
        onClick={async () => setQr(qr ? null : await QRCode.toDataURL(url, { margin: 1, width: 220 }))}
      >
        📱
      </button>
      {qr && (
        <div className="popover" role="dialog" aria-label="Upload from phone">
          <img src={qr} alt="QR code for mobile upload" width={220} height={220} />
          <p className="small">Scan with your phone to send photos or files into this conversation.</p>
          <code className="small">{url}</code>
          <button className="ghost small" onClick={() => setQr(null)}>
            Close
          </button>
        </div>
      )}
    </>
  );
}
