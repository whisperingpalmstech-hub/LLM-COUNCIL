// The second-opinion document inside the app. Following T3 Code's HtmlRenderFrame, it runs in a
// sandboxed iframe with an opaque origin (no access to the app's session), reports its own height,
// and hands link clicks back to the app.
import { Dialog as D } from "@base-ui/react/dialog";
import { Maximize2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "~/lib/theme";
import { Button } from "../ui/button";

function resolvedTheme(pref: string): "light" | "dark" {
  if (pref === "light" || pref === "dark") return pref;
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function DocumentFrame({ src, title, fill = false }: { src: string; title: string; fill?: boolean }) {
  const theme = resolvedTheme(useTheme());
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(640);
  const url = `${src}${src.includes("?") ? "&" : "?"}embed=1&theme=${theme}`;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const data = e.data as { synodDocHeight?: unknown; synodOpen?: unknown };
      if (typeof data?.synodDocHeight === "number") setHeight(Math.min(Math.max(data.synodDocHeight, 200), 20_000));
      if (typeof data?.synodOpen === "string" && /^https?:\/\//.test(data.synodOpen)) window.open(data.synodOpen, "_blank", "noopener");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={frame}
      key={url}
      src={url}
      title={title}
      sandbox="allow-scripts"
      className="block w-full border-0 bg-transparent"
      style={fill ? { height: "100%" } : { height }}
    />
  );
}

export function DocumentView({ src, title }: { src: string; title: string }) {
  const [full, setFull] = useState(false);
  return (
    <div className="group/doc relative">
      <DocumentFrame src={src} title={title} />
      <Button
        variant="outline"
        size="icon-sm"
        className="absolute top-3 right-3 opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover/doc:opacity-100 pointer-coarse:opacity-100"
        aria-label="Open full screen"
        title="Full screen"
        onClick={() => setFull(true)}
      >
        <Maximize2 className="size-3.5" />
      </Button>
      <D.Root open={full} onOpenChange={setFull}>
        <D.Portal>
          <D.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/70" />
          <D.Popup className="fixed inset-3 z-50 overflow-hidden rounded-3xl border bg-popover shadow-2xl outline-none transition-[opacity,scale] duration-200 ease-[var(--ease-out)] data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0 sm:inset-6">
            <D.Title className="sr-only">{title}</D.Title>
            <div className="h-full overflow-y-auto">
              <DocumentFrame src={src} title={title} />
            </div>
            <D.Close render={<Button variant="outline" size="icon-sm" className="absolute top-3 right-3" aria-label="Close" />}>
              <X className="size-3.5" />
            </D.Close>
          </D.Popup>
        </D.Portal>
      </D.Root>
    </div>
  );
}
