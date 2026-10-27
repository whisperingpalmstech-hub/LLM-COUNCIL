import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Attachment } from "@synod/contracts";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_EXCERPT_CHARS = 40_000;
const IMAGE_TYPES = /^image\/(png|jpe?g|webp|gif)$/;
const TEXT_TYPES = /^(text\/|application\/(json|xml|x-yaml|yaml|csv|javascript|typescript|x-sh|sql))/;
const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html?|js|ts|tsx|jsx|py|go|rs|java|rb|sh|sql|toml|ini|log)$/i;

/**
 * Saves an upload under data/uploads and makes it readable by the council:
 * text files as-is, PDFs and Word documents as extracted text, images shown to the models directly.
 */
export async function saveAttachment(
  uploadsDir: string,
  input: { name: string; mimeType: string; data: string; source: Attachment["source"] }
): Promise<Attachment> {
  const buffer = Buffer.from(input.data, "base64");
  if (!buffer.length) throw Object.assign(new Error("File is empty."), { status: 400 });
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw Object.assign(new Error("File exceeds the 10 MB limit."), { status: 413 });
  const id = crypto.randomUUID();
  const name = path.basename(input.name || "upload").replace(/[^\w.\- ]/g, "_").slice(0, 120) || "upload";
  const stored = `${id}-${name.replace(/ /g, "_")}`;
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.writeFile(path.join(uploadsDir, stored), buffer, { mode: 0o600 });
  const mimeType = input.mimeType || guessType(name);
  const { kind, text } = await extract(buffer, mimeType, name);
  return {
    id,
    name,
    kind,
    mimeType,
    size: buffer.length,
    url: `/uploads/${encodeURIComponent(stored)}`,
    source: input.source,
    ...(text ? { excerpt: text.length > MAX_EXCERPT_CHARS ? `${text.slice(0, MAX_EXCERPT_CHARS)}\n…[truncated]` : text } : {})
  };
}

async function extract(buffer: Buffer, mimeType: string, name: string): Promise<{ kind: Attachment["kind"]; text: string }> {
  if (IMAGE_TYPES.test(mimeType)) return { kind: "image", text: "" };
  if (TEXT_TYPES.test(mimeType) || TEXT_EXTENSIONS.test(name)) return { kind: "text", text: buffer.toString("utf8") };
  try {
    if (mimeType === "application/pdf" || /\.pdf$/i.test(name)) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      const clean = String(text).replace(/[ \t]+\n/g, "\n").trim();
      return { kind: "document", text: clean || "" };
    }
    if (/officedocument\.wordprocessingml/.test(mimeType) || /\.docx$/i.test(name)) {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer });
      return { kind: "document", text: value.trim() };
    }
  } catch (error) {
    console.warn(`[attachments] could not read ${name}:`, error instanceof Error ? error.message : error);
  }
  return { kind: "other", text: "" };
}

function guessType(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return (
    ({ pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", txt: "text/plain", md: "text/markdown" } as Record<string, string>)[ext] ??
    "application/octet-stream"
  );
}
