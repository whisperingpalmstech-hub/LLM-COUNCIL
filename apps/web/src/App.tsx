import { useEffect, useState } from "react";
import type { ServerInfo } from "@synod/contracts";
import { CaseView } from "./components/case/CaseView";
import { CommandPalette } from "./components/CommandPalette";
import { MobileUpload } from "./components/MobileUpload";
import { NewCase } from "./components/NewCase";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { api } from "./lib/api";
import { navigate, useRoute } from "./lib/router";

export function App() {
  const route = useRoute();
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    api.info().then(setInfo).catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        navigate("/");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => setSidebarOpen(false), [route]);

  if (route.name === "mobile") return <MobileUpload conversationId={route.id} />;

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        activeId={route.name === "conversation" ? route.id : null}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSettings={() => setSettingsOpen(true)}
        onSearch={() => setPaletteOpen(true)}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {route.name === "conversation" ? (
          <CaseView key={route.id} id={route.id} info={info} onOpenSidebar={() => setSidebarOpen(true)} />
        ) : (
          <NewCase info={info} onOpenSidebar={() => setSidebarOpen(true)} />
        )}
      </main>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} info={info} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onSettings={() => setSettingsOpen(true)} />
    </div>
  );
}
