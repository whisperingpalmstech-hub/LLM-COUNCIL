import { t, setLanguage } from "./i18n.js";
import { avatarHost } from "./avatar.js";

let currentSessionId = null;
let source = null;

const $ = (id) => document.getElementById(id);
const api = (path, options) => fetch(`/api/v1${path}`, options).then(async (res) => {
  const text = await res.text();
  const data = text && res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text;
  if (!res.ok) {
    if (window.showToast) window.showToast(data.error?.message ?? text, "error");
    throw new Error(data.error?.message ?? text);
  }
  return data;
});

window.showToast = function(message, type = 'info') {
  const container = $("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i data-lucide="${type === 'error' ? 'alert-circle' : (type === 'success' ? 'check-circle' : 'info')}" style="width: 18px; height: 18px;"></i> <span>${esc(message)}</span>`;
  container.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();
  setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
};

document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
  button.classList.add("active");
  document.querySelectorAll(".tabPanel").forEach((panel) => panel.classList.add("hidden"));
  $(button.dataset.tab).classList.remove("hidden");
  if (button.dataset.tab === "councils") loadCouncils();
  if (button.dataset.tab === "history") loadHistory();
}));


$("sessionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  avatarHost.onSessionStart();
  const session = await api("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: $("topic").value,
      mode: $("mode").value,
      maxRounds: Number($("rounds").value),
      councilId: $("councilSelect").value || undefined,
      compactInternalCommunication: $("compact").checked,
      allowWebSearch: $("web").checked,
      allowRag: $("rag").checked,
      autoStart: true
    })
  });
  selectSession(session.id);
});

$("councilForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const manifest = JSON.parse($("manifest").value);
  await api("/councils", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: $("councilName").value,
      description: $("councilDescription").value,
      role_manifest: manifest,
      hierarchy: { speaking_order: manifest.map((role) => role.role_type), veto_roles: $("vetoRoles").value.split(",").map((value) => value.trim()).filter(Boolean) },
      model_overrides: JSON.parse($("modelOverrides").value || "{}"),
      default_config: { max_rounds: 4 }
    })
  });
  loadCouncils();
});

$("importCouncil").addEventListener("click", async () => {
  if (!currentSessionId) return showToast("Start or select a session first.", "error");
  await api(`/councils/from-session/${currentSessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `Imported Synod ${currentSessionId.slice(0, 6)}` })
  });
  loadCouncils();
});



async function selectSession(id) {
  currentSessionId = id;
  $("transcript").href = `/api/v1/sessions/${id}/transcript`;
  $("transcript").classList.remove("disabled");
  if (source) source.close();
  source = new EventSource(`/api/v1/sessions/${id}/events`);
  ["ROLE_ACTIVATED", "ROLE_MESSAGE", "ROUND_COMPLETE", "CONSENSUS_UPDATE", "SESSION_COMPLETE", "SESSION_ERROR"].forEach((event) => source.addEventListener(event, refresh));
  await refresh();
}

async function refresh() {
  await loadSessions();
  if (!currentSessionId) return;
  const [session, messages] = await Promise.all([api(`/sessions/${currentSessionId}`), api(`/sessions/${currentSessionId}/messages`)]);
  $("status").innerText = session.status;
  const currentRound = messages.messages?.length ? Math.max(...messages.messages.map(m => m.round_number)) : 0;
  $("round").innerText = session.max_rounds ? `${currentRound}/${session.max_rounds}` : "-";
  if (window.lastAnnouncedRound !== currentRound && currentRound > 0 && session.status !== "COMPLETED") {
    window.lastAnnouncedRound = currentRound;
    avatarHost.onRoundComplete(currentRound);
  }
  $("consensus").innerText = typeof session.consensus === "number" ? session.consensus.toFixed(3) : "-";
  $("internal").innerText = session.compact_internal ? "Compact" : "Verbose";
  $("messages").innerHTML = (messages.messages || []).map((message) => {
    let payload;
    try {
      payload = JSON.parse(message.payload);
      if (typeof payload === "string") payload = JSON.parse(payload);
    } catch(e) {
      payload = { shortSummary: message.content || "Error parsing message payload." };
    }
    
    // Find the role info for the header
    const role = session.roles.find(r => r.id === message.role_id) || {};
    
    let contentHtml = `<div class="summary">${esc(payload.shortSummary || payload.summary || message.content)}</div>`;
    
    if (payload.keyClaims?.length) contentHtml += `<div class="message-section"><h4>${t("key_claims")}</h4><ul>${payload.keyClaims.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>`;
    if (payload.knowledgeGaps?.length) contentHtml += `<div class="message-section"><h4>${t("knowledge_gaps")}</h4><ul>${payload.knowledgeGaps.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>`;
    if (payload.agreements?.length) contentHtml += `<div class="message-section"><h4>${t("agreements")}</h4><ul>${payload.agreements.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>`;
    if (payload.disagreements?.length) contentHtml += `<div class="message-section"><h4>${t("disagreements")}</h4><ul>${payload.disagreements.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>`;

    return `
      <div class="message-card">
        <div class="message-header">
          <div class="role-info">
            <div class="role-icon"><i data-lucide="user" style="width: 18px; height: 18px;"></i></div>
            <div>
              <h3>${esc(role.display_name || "Unknown Role")}</h3>
              <span>${esc(message.model_name)}</span>
            </div>
          </div>
          <span>${t("round")} ${message.round_number}</span>
        </div>
        <div class="message-body">
          ${contentHtml}
        </div>
      </div>
    `;
  }).join("");

  const verdictContainer = $("verdict");
  if (session.verdict) {
    if (window.lastAnnouncedVerdict !== session.id) {
      window.lastAnnouncedVerdict = session.id;
      avatarHost.onVerdict(session.verdict.summary);
    }
    verdictContainer.innerHTML = `
      <div style="background: var(--blue-light); padding: 24px; border-radius: 12px; border: 1px solid var(--primary); margin-bottom: 24px;">
        <h3 style="color: var(--primary); margin-top: 0; display: flex; align-items: center; gap: 8px;"><i data-lucide="award"></i> ${t("final_verdict")}</h3>
        <b style="font-size: 16px; display: block; margin-bottom: 12px;">${esc(session.verdict.summary)}</b>
        <p style="margin: 0; line-height: 1.6;">${esc(session.verdict.majority)}</p>
      </div>
    `;
  } else if (session.warnings?.length) {
    verdictContainer.innerHTML = session.warnings.map(w => `<p style="color: var(--red);">${esc(w.code)}: ${esc(w.message)}</p>`).join("");
  } else {
    verdictContainer.innerHTML = "";
  }

  if (session.status === "DELIBERATING" || session.status === "CREATED") {
    $("loader").classList.remove("hidden");
  } else {
    $("loader").classList.add("hidden");
  }

  const msgs = $("messages");
  msgs.scrollTop = msgs.scrollHeight;
}

async function loadSessions() {
  const { sessions } = await api("/sessions");
  $("sessions").innerHTML = sessions.map((session) => `<button class="item" data-id="${session.id}"><b>${esc(session.topic)}</b><p>${session.status} · ${t("round")} ${session.current_round}</p></button>`).join("") || `<p>${t("no_sessions")}</p>`;
  document.querySelectorAll("[data-id]").forEach((button) => button.addEventListener("click", () => selectSession(button.dataset.id)));
}

async function loadCouncils() {
  const [{ councils }, { workspaces }] = await Promise.all([api("/councils"), api("/workspaces")]);
  $("councilList").innerHTML = councils.map((council) => `<div class="item"><b>${esc(council.name)}</b><p>${esc(council.description)} · ${JSON.parse(council.role_manifest).length} roles</p></div>`).join("") || `<p>${t("no_councils")}</p>`;
  $("councilSelect").innerHTML = councils
    .filter(council => council.name === "AnythingLLM Full Council")
    .map((council) => `<option value="${council.id}" selected>${esc(council.name)}</option>`)
    .join("");
  const manifest = safeJson($("manifest").value, []);
  const ids = manifest.map((role) => role.workspace_id).filter(Boolean);
  $("workspacePreview").textContent = ids.length
    ? ids.map((workspaceId) => workspaces.some((workspace) => workspace.id === workspaceId || workspace.external_id === workspaceId) ? `${workspaceId}: available` : `${workspaceId}: not found, fallback will bind by similarity`).join("\n")
    : "No pre-bound workspace IDs in this manifest.";
}

function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

async function loadHistory() {
  const { sessions } = await api("/sessions");
  $("historyList").innerHTML = sessions.map((session) => `
    <div class="item">
      <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="toggleHistoryDetails('${session.id}')">
        <div>
          <b style="font-size: 18px;">${esc(session.topic)}</b>
          <p>${session.status} · ${session.current_round} ${t("rounds")} · ${new Date(session.created_at).toLocaleString()}</p>
        </div>
        <button class="button"><i data-lucide="chevron-down" style="width: 16px; height: 16px;"></i> ${t("view_details")}</button>
      </div>
      <div id="history-details-${session.id}" class="hidden" style="margin-top: 16px; border-top: 1px solid var(--border); padding-top: 16px;">
        ${t("loading")}
      </div>
    </div>
  `).join("") || `<p>${t("no_history")}</p>`;
  if (window.lucide) window.lucide.createIcons();
}

window.toggleHistoryDetails = async function(id) {
  const detailsDiv = $("history-details-" + id);
  if (!detailsDiv.classList.contains("hidden")) {
    detailsDiv.classList.add("hidden");
    return;
  }
  detailsDiv.classList.remove("hidden");
  if (detailsDiv.innerHTML.includes(t("loading")) || detailsDiv.innerHTML.includes("Loading...")) {
    const [session, messages] = await Promise.all([api("/sessions/" + id), api("/sessions/" + id + "/messages")]);
    
    let verdictHtml = "";
    if (session.verdict) {
      if (window.lastAnnouncedVerdict !== session.id) {
        window.lastAnnouncedVerdict = session.id;
        avatarHost.onVerdict(session.verdict.summary);
      }
      verdictHtml = `<div style="background: var(--blue-light); padding: 24px; border-radius: 12px; border: 1px solid var(--primary); margin-bottom: 24px;">
        <h3 style="color: var(--primary); margin-top: 0; display: flex; align-items: center; gap: 8px;"><i data-lucide="award"></i> ${t("final_verdict")}</h3>
        <b style="font-size: 16px; display: block; margin-bottom: 12px;">${esc(session.verdict.summary)}</b>
        <p style="margin: 0; line-height: 1.6;">${esc(session.verdict.majority)}</p>
      </div>`;
    }

    const messagesHtml = (messages.messages || []).map((message) => {
      let payload;
      try {
        payload = JSON.parse(message.payload);
        if (typeof payload === "string") payload = JSON.parse(payload);
      } catch(e) {
        payload = { shortSummary: message.content || "Error parsing message payload." };
      }
      
      const role = session.roles.find(r => r.id === message.role_id) || {};
      
      let contentHtml = `<div class="summary">${esc(payload.shortSummary || payload.summary || message.content)}</div>`;
      if (payload.keyClaims?.length) contentHtml += `<div class="message-section"><h4>${t("key_claims")}</h4><ul>${payload.keyClaims.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>`;
      if (payload.knowledgeGaps?.length) contentHtml += `<div class="message-section"><h4>${t("knowledge_gaps")}</h4><ul>${payload.knowledgeGaps.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>`;
      if (payload.agreements?.length) contentHtml += `<div class="message-section"><h4>${t("agreements")}</h4><ul>${payload.agreements.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>`;
      if (payload.disagreements?.length) contentHtml += `<div class="message-section"><h4>${t("disagreements")}</h4><ul>${payload.disagreements.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>`;

      return `
        <div class="message-card">
          <div class="message-header">
            <div class="role-info">
              <div class="role-icon"><i data-lucide="user" style="width: 18px; height: 18px;"></i></div>
              <div>
                <h3>${esc(role.display_name || "Unknown Role")}</h3>
                <span>${esc(message.model_name)}</span>
              </div>
            </div>
            <span>${t("round")} ${message.round_number}</span>
          </div>
          <div class="message-body">
            ${contentHtml}
          </div>
        </div>
      `;
    }).join("");
    
    detailsDiv.innerHTML = verdictHtml + `<div class="messages">${messagesHtml}</div>`;
    if (window.lucide) window.lucide.createIcons();
  }
}

// Initial language set
setLanguage($("langToggle").value);

$("langToggle").addEventListener("change", (e) => {
  setLanguage(e.target.value);
  loadSessions();
  loadCouncils();
  loadHistory();
  if (currentSessionId) refresh();
});

loadSessions();
loadCouncils();

// Tab switching logic
document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tabPanel").forEach(p => p.classList.add("hidden"));
    
    button.classList.add("active");
    const tabId = button.getAttribute("data-tab");
    $(tabId).classList.remove("hidden");
    
    if (tabId === "history") loadHistory();
    if (tabId === "councils") loadCouncils();
  });
});

