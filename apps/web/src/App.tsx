import { useEffect, useState } from "react";
import type { ServerInfo } from "@synod/contracts";
import { AuthPage } from "./components/AuthPage";
import { CaseView } from "./components/case/CaseView";
import { CommandPalette } from "./components/CommandPalette";
import { Landing } from "./components/Landing";
import { MobileUpload } from "./components/MobileUpload";
import { NewCase } from "./components/NewCase";
import { SettingsDialog } from "./components/SettingsDialog";
import { Welcome } from "./components/Welcome";
import { Logo, Sidebar } from "./components/Sidebar";
import { api } from "./lib/api";
import { useAuth } from "./lib/auth";
import { navigate, useRoute } from "./lib/router";

export function App() {
  const route = useRoute();
  const auth = useAuth();

  // Public pages.
  if (route.name === "mobile") return <MobileUpload conversationId={route.id} />;
  if (route.name === "landing") return <Landing />;
  if (auth.status === "loading") return <Splash />;
  if (route.name === "login" || route.name === "signup") {
    if (auth.status === "signed-in") {
      navigate("/new", { replace: true });
      return null;
    }
    return <AuthPage key={route.name} mode={route.name} />;
  }
  if (auth.status === "signed-out") {
    navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
    return null;
  }
  // New accounts answer a few questions first; the answers become context for every case.
  if (route.name === "welcome") return <Welcome />;
  if (!auth.user.profile) {
    navigate("/welcome", { replace: true });
    return null;
  }
  return <Workspace />;
}

function Workspace() {
  const route = useRoute();
  const auth = useAuth();
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
        navigate("/new");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => setSidebarOpen(false), [route]);

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
        {route.name === "conversation" ? <CaseView key={route.id} id={route.id} info={info} onOpenSidebar={() => setSidebarOpen(true)} /> : <NewCase info={info} onOpenSidebar={() => setSidebarOpen(true)} />}
      </main>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} info={info} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onSettings={() => setSettingsOpen(true)} />
    </div>
  );
}

function Splash() {
  return (
    <div className="flex h-dvh items-center justify-center">
      <Logo className="size-7 animate-pulse" />
    </div>
  );
}
