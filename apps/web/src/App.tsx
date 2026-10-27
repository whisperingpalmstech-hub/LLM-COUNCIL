import { useEffect, useState } from "react";
import type { ServerInfo } from "@synod/contracts";
import { ConversationView } from "./components/ConversationView";
import { CouncilSettings } from "./components/CouncilSettings";
import { MobileUpload } from "./components/MobileUpload";
import { Sidebar } from "./components/Sidebar";
import { api } from "./lib/api";
import { navigate, useRoute } from "./lib/router";

export function App() {
  const route = useRoute();
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    api.info().then(setInfo).catch(() => undefined);
  }, []);

  if (route.name === "mobile") return <MobileUpload conversationId={route.id} />;

  const startConversation = async () => {
    const conversation = await api.createConversation();
    navigate(`/c/${conversation.id}`);
  };

  return (
    <div className="app">
      <Sidebar activeId={route.name === "conversation" ? route.id : null} onNew={startConversation} onSettings={() => setSettingsOpen(true)} />
      <main className="main">
        {route.name === "conversation" ? (
          <ConversationView key={route.id} id={route.id} info={info} />
        ) : (
          <div className="empty-state">
            <h1>Synod</h1>
            <p>Ask a question. Several models answer it on their own, review each other's answers anonymously, and a chairman turns that into one answer and a plan.</p>
            <button className="primary" onClick={startConversation}>
              New conversation
            </button>
          </div>
        )}
      </main>
      {settingsOpen && <CouncilSettings info={info} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
