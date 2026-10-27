import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Attachment } from "@synod/contracts";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_EXCERPT_CHARS = 20_000;
const TEXT_TYPES = /^(text\/|application\/(json|xml|x-yaml|yaml|csv|javascript|typescript|x-sh|sql))/;
const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html?|js|ts|tsx|jsx|py|go|rs|java|rb|sh|sql|toml|ini|log)$/i;

/** Saves an upload under data/uploads and extracts a text excerpt the council can read. */
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
  const isText = TEXT_TYPES.test(input.mimeType) || TEXT_EXTENSIONS.test(name);
  const text = isText ? buffer.toString("utf8") : "";
  return {
    id,
    name,
    mimeType: input.mimeType || "application/octet-stream",
    size: buffer.length,
    url: `/uploads/${encodeURIComponent(stored)}`,
    source: input.source,
    ...(text ? { excerpt: text.length > MAX_EXCERPT_CHARS ? `${text.slice(0, MAX_EXCERPT_CHARS)}\n…[truncated]` : text } : {})
  };
}
