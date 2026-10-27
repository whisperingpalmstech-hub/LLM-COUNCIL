import { Check, Copy } from "lucide-react";
import { memo, useEffect, useId, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn } from "~/lib/utils";

export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("prose-synod", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-lg border">
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const language = /language-(\w+)/.exec(className ?? "")?.[1];
            const text = String(children ?? "").replace(/\n$/, "");
            if (!language && !text.includes("\n")) return <code>{children}</code>;
            if (language === "mermaid") return <Mermaid source={text} />;
            return <CodeBlock language={language} code={text} />;
          }
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

function CodeBlock({ language, code }: { language?: string; code: string }) {
  return (
    <div className="group/code relative overflow-hidden rounded-lg border bg-code">
      <div className="flex items-center justify-between border-b px-3 py-1 text-2xs text-muted-foreground">
        <span className="font-mono">{language ?? "text"}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[0.8125rem] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function CopyButton({ text, label, className }: { text: string; label?: ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={cn("inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:text-foreground", className)}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label="Copy"
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {label}
    </button>
  );
}

/** Mermaid diagrams, loaded on first use so they don't weigh down the main bundle. */
function Mermaid({ source }: { source: string }) {
  const id = useId().replace(/:/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: document.documentElement.classList.contains("dark") ? "dark" : "neutral" });
        const { svg } = await mermaid.render(`m${id}`, source);
        if (!cancelled) setSvg(svg);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [id, source]);
  if (failed) return <CodeBlock language="mermaid" code={source} />;
  return (
    <div className="flex justify-center overflow-x-auto rounded-lg border bg-code p-4">
      {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="text-muted-foreground text-xs">Rendering diagram…</span>}
    </div>
  );
}
