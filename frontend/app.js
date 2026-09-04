import { translations, setLanguage, t, getCurrentLang } from "./i18n.js";
import { avatarHost } from "./avatar.js";

let currentSessionId = null;
let source = null;
let pollTimer = null;
let refreshInFlight = false;
let simpleModeActive = false;
let activeContextVisible = true;
let companionPersonaBrief = "";
let companionDefaultOutcome = "";
let currentSession = null;
let councilActivityVisible = false;
let nextMessageMode = "fresh";
let sessionListState = "active";
let openingGreetingSpoken = false;
let advancedView = localStorage.getItem("synod-advanced-view") === "true";
const renderedMessageIds = new Set();
const originalTitle = document.title;

const $ = (id) => document.getElementById(id);
window.synodTranslate = t;
const upstreamErrorPattern = /(?:<!doctype\s+html|<html\b|cf-error|cloudflare\s+tunnel|cloudflared|trycloudflare\.com|webassets\/errors|error\s+(?:502|503|520|522|523|525|1033))/i;
const upstreamErrorMessage = "A temporary secure-connection error interrupted this response. Your question is safe. Please retry in a moment.";
function safeDisplayText(value, fallback = upstreamErrorMessage) {
  const text = String(value ?? "").trim();
  return upstreamErrorPattern.test(text) ? fallback : text;
}
const api = (path, options) => fetch(`/api/v1${path}`, options).then(async (res) => {
  const text = await res.text();
  const data = text && res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text;
  if (!res.ok) {
    const message = safeDisplayText(data?.error?.message ?? text, `Synod is temporarily unavailable (HTTP ${res.status}). Please retry in a moment.`);
    if (window.showToast) window.showToast(message, "error");
    throw new Error(message);
  }
  return data;
});

window.showToast = function(message, type = 'info', action = null) {
  const container = $("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i data-lucide="${type === 'error' ? 'alert-circle' : (type === 'success' ? 'check-circle' : 'info')}" style="width: 18px; height: 18px;"></i> <span>${esc(message)}</span>`;
  if (action?.label && action?.run) {
    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = "toast-action";
    actionButton.textContent = action.label;
    actionButton.addEventListener("click", () => { action.run(); toast.remove(); }, { once: true });
    toast.appendChild(actionButton);
  }
  container.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();
  setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
};

function closeDrawers() {
  if ($("leftDrawer")) $("leftDrawer").classList.add("hidden-drawer");
  if ($("rightDrawer")) $("rightDrawer").classList.add("hidden-drawer");
}

document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
  button.classList.add("active");
  closeDrawers();
  
  if (button.dataset.tab === "history") {
     if ($("leftDrawer")) $("leftDrawer").classList.remove("hidden-drawer");
     loadHistory();
  } else if (button.dataset.tab === "settings") {
     if ($("rightDrawer")) $("rightDrawer").classList.remove("hidden-drawer");
     loadSettings();
  } else if (button.dataset.tab === "councils") {
     if ($("rightDrawer")) $("rightDrawer").classList.remove("hidden-drawer");
     loadCouncils();
  }
}));

if ($("closeLeftDrawerBtn")) $("closeLeftDrawerBtn").addEventListener("click", closeDrawers);
if ($("closeRightDrawerBtn")) $("closeRightDrawerBtn").addEventListener("click", closeDrawers);

function setCompanionRailCollapsed(collapsed) {
  const rail = $("companionRail");
  const toggle = $("sidebarToggle");
  if (!rail || !toggle) return;
  rail.classList.toggle("is-collapsed", collapsed);
  document.body.classList.toggle("companion-rail-collapsed", collapsed);
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.title = collapsed ? "Expand companion sidebar" : "Collapse companion sidebar";
  toggle.innerHTML = `<i data-lucide="${collapsed ? "panel-left-open" : "panel-left-close"}"></i><span class="sr-only">${collapsed ? "Expand" : "Collapse"} companion sidebar</span>`;
  localStorage.setItem("synod-companion-rail-collapsed", String(collapsed));
  if (window.lucide) window.lucide.createIcons();
}

$("sidebarToggle")?.addEventListener("click", () => {
  setCompanionRailCollapsed(!$("companionRail")?.classList.contains("is-collapsed"));
});

function setAdviceMode(mode) {
  const detailed = mode === "detailed";
  $("mainMode").value = detailed ? "deep" : "fast";
  $("mainRounds").value = detailed ? "3" : "1";
  document.querySelectorAll("[data-advice-mode]").forEach((button) => {
    const active = button.dataset.adviceMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if ($("mainTopicInput")) {
    $("mainTopicInput").placeholder = detailed
      ? "Describe the choice, constraints, and what is at stake…"
      : "Ask Synod anything…";
  }
  const action = $("mainConveneBtn");
  if (action) {
    action.querySelector("span").textContent = detailed ? "Get advice" : "Ask Synod";
    action.title = detailed ? "Get detailed advice" : "Ask Synod";
  }
  localStorage.setItem("synod-advice-mode", mode);
}

document.querySelectorAll("[data-advice-mode]").forEach((button) => button.addEventListener("click", () => setAdviceMode(button.dataset.adviceMode)));
setCompanionRailCollapsed(localStorage.getItem("synod-companion-rail-collapsed") === "true");
if (localStorage.getItem("synod-advice-mode")) setAdviceMode(localStorage.getItem("synod-advice-mode") === "detailed" ? "detailed" : "quick");
else {
  $("mainMode").value = "auto";
  document.querySelectorAll("[data-advice-mode]").forEach((button) => button.classList.remove("active"));
}

function setAdvancedView(enabled) {
  advancedView = Boolean(enabled);
  document.body.classList.toggle("advanced-view", advancedView);
  const button = $("advancedViewToggle");
  if (button) {
    button.setAttribute("aria-pressed", String(advancedView));
    button.classList.toggle("active", advancedView);
    button.querySelector("span").textContent = advancedView ? "Simple view" : "Advanced view";
  }
  localStorage.setItem("synod-advanced-view", String(advancedView));
}

$("advancedViewToggle")?.addEventListener("click", () => setAdvancedView(!advancedView));
setAdvancedView(advancedView);

document.querySelectorAll("[data-starter]").forEach((button) => button.addEventListener("click", () => {
  $("mainTopicInput").value = button.dataset.starter;
  $("mainTopicInput").focus();
}));

function decisionTuning() {
  const selectedMode = $("mainMode")?.value || "auto";
  return { mode: selectedMode, maxRounds: selectedMode === "auto" ? undefined : Number($("mainRounds")?.value || 2) };
}

function setCouncilActivityVisible(visible) {
  const toggle = $("councilActivityToggle");
  councilActivityVisible = Boolean(visible && currentSessionId);
  document.body.classList.toggle("show-council-activity", councilActivityVisible);
  if (!toggle) return;
  const councilIsWorking = toggle.dataset.active === "true";
  toggle.setAttribute("aria-expanded", String(councilActivityVisible));
  toggle.title = councilActivityVisible ? "Hide council activity" : "Show council activity";
  toggle.innerHTML = councilActivityVisible
    ? '<i data-lucide="chevron-up"></i><span>Hide activity</span>'
    : `<i data-lucide="${councilIsWorking ? "activity" : "workflow"}"></i><span>${councilIsWorking ? "Council working" : "Council activity"}</span>`;
  if (window.lucide) window.lucide.createIcons();
}

$("councilActivityToggle")?.addEventListener("click", () => setCouncilActivityVisible(!councilActivityVisible));

$("phoneUploadToggle")?.addEventListener("click", () => {
  const card = $("mobileBridgeCard");
  const toggle = $("phoneUploadToggle");
  if (!card || !toggle) return;
  const open = card.classList.contains("hidden");
  card.classList.toggle("hidden", !open);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.title = open ? "Hide phone upload" : "Upload from your phone";
});

let customAvatarVideoData = null;

async function loadSettings() {
  const settings = await api("/settings");
  $("settingUrl").value = settings.ANYTHING_LLM_URL || settings.ANYTHINGLLM_BASE_URL || "http://localhost:3001/api/v1";
  setSecretField($("settingKey"), settings.ANYTHING_LLM_API_KEY || settings.ANYTHINGLLM_API_KEY);
  $("settingKelly").value = settings.KELLY_CIRCUIT_BREAKER_PERCENT || "5";
  $("settingEntropy").value = settings.ENTROPY_THRESHOLD || "30";
  if ($("settingDefaultBudget")) $("settingDefaultBudget").value = settings.DEFAULT_CONVERSATION_BUDGET_USD || "1.00";
  setSecretField($("settingSiliconKey"), settings.SILICONFLOW_API_KEY);
  $("settingSiliconModel").value = settings.SILICONFLOW_MODEL || "Qwen/Qwen2.5-72B-Instruct";
  $("settingDbType").value = settings.DB_TYPE || "sqlite";
  $("settingDbUrl").value = settings.DB_URL || "";
  
  $("settingEnableVoice").checked = settings.ENABLE_VOICE === "true";
  avatarHost.setOutputEnabled(settings.ENABLE_VOICE === "true");
  $("settingTtsEngine").value = settings.TTS_ENGINE || "browser";
  setSecretField($("settingElevenKey"), settings.ELEVENLABS_API_KEY);
  $("settingElevenVoice").value = settings.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  
  if ($("settingPromptInterviewer")) $("settingPromptInterviewer").value = settings.PROMPT_INTERVIEWER || "";
  if ($("settingPromptDeliberation")) $("settingPromptDeliberation").value = settings.PROMPT_DELIBERATION || "";
  if ($("settingPromptVerdict")) $("settingPromptVerdict").value = settings.PROMPT_VERDICT || "";
  companionPersonaBrief = settings.COMPANION_PERSONA_BRIEF || "";
  companionDefaultOutcome = settings.COMPANION_DEFAULT_OUTCOME || "A clear, evidence-aware next step I can act on.";
  activeContextVisible = settings.SHOW_ACTIVE_CONTEXT !== "false";
  if ($("settingCompanionBrief")) $("settingCompanionBrief").value = companionPersonaBrief;
  if ($("settingCompanionOutcome")) $("settingCompanionOutcome").value = companionDefaultOutcome;
  if ($("settingShowContext")) $("settingShowContext").checked = activeContextVisible;
  if ($("mainOutcome") && !$("mainOutcome").value.trim()) $("mainOutcome").value = companionDefaultOutcome;
  
  if (settings.AVATAR_VIDEO_URL) {
    const video = $("avatarVideo");
    if (video) {
      video.src = settings.AVATAR_VIDEO_URL + "?t=" + Date.now();
      video.load();
    }
  }
  await loadPromptRegistry();
}

async function loadPromptRegistry() {
  const host = $("promptRegistry");
  if (!host) return;
  const { prompts } = await api("/prompts");
  host.innerHTML = prompts.map((prompt) => `<details class="prompt-editor" data-prompt-id="${esc(prompt.id)}"><summary><span><strong>${esc(prompt.name)}</strong><small>${esc(prompt.scope)} · v${prompt.version}${prompt.customized ? " · customized" : ""}</small></span><i data-lucide="chevron-down"></i></summary><p>${esc(prompt.description)}</p><textarea aria-label="${esc(prompt.name)} prompt" maxlength="30000">${esc(prompt.promptText)}</textarea><div><button class="button" type="button" data-prompt-save>Save prompt</button><button class="button" type="button" data-prompt-reset>Restore default</button></div></details>`).join("");
  host.querySelectorAll("[data-prompt-save]").forEach((button) => button.addEventListener("click", async () => {
    const editor = button.closest("[data-prompt-id]");
    await api(`/prompts/${encodeURIComponent(editor.dataset.promptId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promptText: editor.querySelector("textarea").value }) });
    showToast("Prompt saved for future decisions.", "success"); await loadPromptRegistry();
  }));
  host.querySelectorAll("[data-prompt-reset]").forEach((button) => button.addEventListener("click", async () => {
    const editor = button.closest("[data-prompt-id]");
    await api(`/prompts/${encodeURIComponent(editor.dataset.promptId)}/reset`, { method: "POST" });
    showToast("Default prompt restored.", "success"); await loadPromptRegistry();
  }));
  if (window.lucide) window.lucide.createIcons();
}

function setSecretField(field, value) {
  if (!field) return;
  const configured = value === "__CONFIGURED__";
  field.value = "";
  field.placeholder = configured ? "Configured securely" : "Not configured";
  field.dataset.configured = configured ? "true" : "false";
  const state = field.closest(".secret-control")?.querySelector(".secret-state");
  if (state) {
    state.textContent = configured ? "Stored securely · Leave blank to keep it" : "No key stored";
    state.classList.toggle("configured", configured);
  }
}

if ($("settingAvatarVideo")) {
  $("settingAvatarVideo").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      e.target.value = "";
      showToast("Avatar video must be 8 MB or smaller.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      customAvatarVideoData = event.target.result;
      showToast("Avatar video attached. Save settings to apply.", "success");
    };
    reader.readAsDataURL(file);
  });
}

$("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const priorDefaultOutcome = companionDefaultOutcome;
  const priorMainOutcome = $("mainOutcome")?.value.trim();
  await api("/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ANYTHING_LLM_URL: $("settingUrl").value,
      ANYTHING_LLM_API_KEY: $("settingKey").value,
      SILICONFLOW_API_KEY: $("settingSiliconKey").value,
      SILICONFLOW_MODEL: $("settingSiliconModel").value,
      DB_TYPE: $("settingDbType").value,
      DB_URL: $("settingDbUrl").value,
      KELLY_CIRCUIT_BREAKER_PERCENT: $("settingKelly").value,
      ENTROPY_THRESHOLD: $("settingEntropy").value,
      DEFAULT_CONVERSATION_BUDGET_USD: $("settingDefaultBudget")?.value || "1.00",
      ENABLE_VOICE: $("settingEnableVoice").checked ? "true" : "false",
      TTS_ENGINE: $("settingTtsEngine").value,
      ELEVENLABS_API_KEY: $("settingElevenKey").value,
      ELEVENLABS_VOICE_ID: $("settingElevenVoice").value,
      PROMPT_INTERVIEWER: $("settingPromptInterviewer") ? $("settingPromptInterviewer").value : "",
      PROMPT_DELIBERATION: $("settingPromptDeliberation") ? $("settingPromptDeliberation").value : "",
      PROMPT_VERDICT: $("settingPromptVerdict") ? $("settingPromptVerdict").value : "",
      COMPANION_PERSONA_BRIEF: $("settingCompanionBrief") ? $("settingCompanionBrief").value : "",
      COMPANION_DEFAULT_OUTCOME: $("settingCompanionOutcome") ? $("settingCompanionOutcome").value : "",
      SHOW_ACTIVE_CONTEXT: $("settingShowContext")?.checked ? "true" : "false",
      AVATAR_VIDEO_DATA: customAvatarVideoData || undefined
    })
  });
  
  customAvatarVideoData = null;
  if ($("settingAvatarVideo")) $("settingAvatarVideo").value = "";
  await loadSettings();
  if ($("mainOutcome") && (!priorMainOutcome || priorMainOutcome === priorDefaultOutcome)) {
    $("mainOutcome").value = companionDefaultOutcome;
  }
  if (currentSessionId) await refresh();
  showToast("Settings saved successfully!", "success");
});

$("testConnectionsBtn")?.addEventListener("click", async () => {
  const button = $("testConnectionsBtn");
  const container = $("connectionHealth");
  button.disabled = true;
  container.textContent = "Testing authenticated connections…";
  try {
    const health = await api("/settings/health");
    const entries = [
      ["Active LLM", health.llm],
      ["AnythingLLM", health.anythingllm],
      ["Web search", health.search]
    ];
    container.innerHTML = entries.map(([label, result]) => {
      const state = result?.ok ? "Connected" : result?.configured === false ? "Not configured" : "Failed";
      const detail = result?.provider || result?.mode || result?.error || result?.message || "unknown";
      const stateClass = result?.ok ? "ok" : result?.configured === false ? "warn" : "fail";
      return `<div class="connection-row"><span>${esc(label)} <small>${esc(detail)}</small></span><strong class="connection-state ${stateClass}">${esc(state)}</strong></div>`;
    }).join("");
    showToast(health.llm?.ok ? "Active LLM connection verified." : "Active LLM connection failed.", health.llm?.ok ? "success" : "error");
  } catch (error) {
    container.textContent = `Connection test failed: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});



let attachedFile = null;

const composerPanel = document.querySelector(".composer");
if (composerPanel) {
  composerPanel.addEventListener("dragover", (e) => {
    e.preventDefault();
    composerPanel.style.borderColor = "var(--accent)";
  });

  composerPanel.addEventListener("dragleave", () => {
    composerPanel.style.borderColor = "";
  });

  composerPanel.addEventListener("drop", (e) => {
    e.preventDefault();
    composerPanel.style.borderColor = "";
    const file = e.dataTransfer.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        attachedFile = {
          fileName: file.name,
          fileType: file.type,
          fileData: event.target.result
        };
        showToast(`Attached file: ${file.name}`, "success");
      };
      reader.readAsDataURL(file);
    }
  });
}

$("sessionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  avatarHost.onSessionStart();
  const isSuperbrain = $("superbrain").checked;
  const payload = {
    topic: $("topic").value,
    mode: $("mode").value,
    maxRounds: Number($("rounds").value),
    councilId: $("councilSelect").value || undefined,
    compactInternalCommunication: $("compact").checked,
    allowWebSearch: $("web").checked,
    allowRag: $("rag").checked,
    tone: $("mainTone")?.value || "trusted",
    useMemory: $("mainMemory")?.checked ?? true,
    desiredOutcome: $("mainOutcome")?.value.trim() || companionDefaultOutcome,
    personaBrief: companionPersonaBrief,
    budgetLimitUsd: $("mainBudget")?.value || undefined,
    autoStart: !isSuperbrain
  };
  
  await createAndSelectSession(payload, isSuperbrain);
});

async function createAndSelectSession(payload, isSuperbrain) {
  const endpoint = isSuperbrain ? "/pipelines" : "/sessions";
  if (attachedFile) {
    payload.fileName = attachedFile.fileName;
    payload.fileType = attachedFile.fileType;
    payload.fileData = attachedFile.fileData;
    attachedFile = null;
    setContextAttachmentLabel();
  }
  const session = await api(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  // /sessions starts work on the next event-loop tick. Give it a moment so the
  // event stream is attached after the session has actually entered its run.
  if (!isSuperbrain) await new Promise((resolve) => setTimeout(resolve, 75));
  await selectSession(session.id);
  return session;
}

function maybeSpeakOpeningGreeting(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return;
  if (openingGreetingSpoken) return;
  openingGreetingSpoken = true;
  setTimeout(() => {
    try {
      avatarHost.initializeWelcome();
      avatarHost.triggerGuide(clean);
    } catch (error) {
      console.warn("Opening avatar greeting unavailable", error);
    }
  }, 650);
}

async function loadCompanionGreeting() {
  const greeting = $("companionGreeting");
  if (!greeting) return;
  try {
    const memory = await api("/memory/status");
    if (memory.noteCount > 0) {
      greeting.textContent = `Your vault has ${memory.noteCount} saved decision${memory.noteCount === 1 ? "" : "s"}. I’ll use only relevant notes when you leave saved context enabled below.`;
      maybeSpeakOpeningGreeting(greeting.textContent);
      return;
    }
  } catch (error) {
    console.warn("Memory greeting unavailable", error);
  }
  const options = [
    "What kind of chaos or brilliance are we bringing to the workspace today?",
    "Blank canvas. What are we untangling?",
    "Bring me the decision, the mess, or the half-baked plan. We can work with all three."
  ];
  greeting.textContent = options[Math.floor(Math.random() * options.length)];
  maybeSpeakOpeningGreeting(greeting.textContent);
}

const savedTone = localStorage.getItem("synod-tone");
if (savedTone && $("mainTone")) $("mainTone").value = savedTone;
$("mainTone")?.addEventListener("change", () => localStorage.setItem("synod-tone", $("mainTone").value));
loadCompanionGreeting();


$("interviewForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("interviewInput");
  const msg = input.value;
  if (!msg || !currentSessionId) return;
  
  const chat = $("interviewChat");
  const pending = document.createElement("div");
  pending.style.cssText = "padding:8px;border-radius:4px;background:rgba(37,99,235,0.2);text-align:right";
  pending.innerHTML = `<strong>You:</strong> ${esc(msg)}`;
  chat.appendChild(pending);
  input.value = "";
  const button = event.currentTarget.querySelector("button[type=submit]");
  input.disabled = true;
  button.disabled = true;
  try {
    await api(`/sessions/${currentSessionId}/interview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg })
    });
    await refresh();
  } catch (error) {
    pending.remove();
    input.value = msg;
    showToast(`Your answer was not saved: ${error.message}`, "error");
  } finally {
    input.disabled = false;
    button.disabled = false;
    input.focus();
  }
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

async function playTTS(text) {
  if (!$("settingEnableVoice").checked) return;
  const engine = $("settingTtsEngine").value;
  
  if (engine === "browser") {
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  } else if (engine === "elevenlabs") {
    const apiKey = $("settingElevenKey").value;
    const voiceId = $("settingElevenVoice").value || "21m00Tcm4TlvDq8ikWAM";
    if (!apiKey) {
      showToast("ElevenLabs API Key is missing in settings", "error");
      return;
    }
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "Accept": "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": apiKey
        },
        body: JSON.stringify({
          text: text,
          model_id: "eleven_monolingual_v1",
          voice_settings: { stability: 0.5, similarity_boost: 0.5 }
        })
      });
      if (!response.ok) throw new Error("ElevenLabs API error: " + response.status);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
    } catch (e) {
      showToast("TTS Error: " + e.message, "error");
    }
  }
}

async function selectSession(id) {
  currentSessionId = id;
  nextMessageMode = null;
  setCouncilActivityVisible(false);
  document.body.classList.add("has-session");
  renderedMessageIds.clear();
  $("transcript").href = `/api/v1/sessions/${id}/transcript`;
  $("transcript").classList.remove("disabled");
  
  if ($("chatFeed")) $("chatFeed").classList.remove("hidden");
  if ($("welcomer")) $("welcomer").classList.add("hidden");

  
  // Show mobile portal link / QR code
  try {
    const ipRes = await api("/mobile/ip");
    const secureCurrentOrigin = window.location.protocol === "https:" ? window.location.origin : "";
    const portalOrigin = ipRes.publicBaseUrl || secureCurrentOrigin || `http://${ipRes.ip}:3000`;
    const portalUrl = `${portalOrigin}/mobile.html?sessionId=${id}`;
    $("mobileQr").src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(portalUrl)}`;
    $("mobileLink").href = portalUrl;
    $("mobileBridgeCard").classList.add("hidden");
    $("phoneUploadToggle").classList.remove("hidden");
    $("phoneUploadToggle").setAttribute("aria-expanded", "false");
  } catch (err) {
    console.error("Failed to generate QR code", err);
    $("mobileBridgeCard").classList.add("hidden");
    $("phoneUploadToggle").classList.add("hidden");
  }

  stopSessionUpdates();
  source = new EventSource(`/api/v1/sessions/${id}/events`);
  source.onopen = () => {
    document.body.classList.remove("connection-lost");
    stopPolling();
  };
  source.onerror = () => {
    document.body.classList.add("connection-lost");
    startPolling(id);
  };
  ["ROLE_ACTIVATED", "ROLE_MESSAGE", "ROUND_COMPLETE", "CONSENSUS_UPDATE", "SESSION_COMPLETE", "SESSION_ERROR", "SESSION_STATE_CHANGED", "INTERVIEW_QUESTION", "PIPELINE_STAGE_COMPLETE", "EXECUTION_HANDOFF"].forEach((event) => {
    source.addEventListener(event, async (e) => {
      const data = JSON.parse(e.data);
      const completedEvent = data.eventType === "SESSION_COMPLETE" || (data.eventType === "SESSION_STATE_CHANGED" && data.status === "COMPLETED");
      if (data.eventType === "INTERVIEW_QUESTION") {
        const chat = $("interviewChat");
        chat.innerHTML += `<div style="padding: 8px; border-radius: 4px; background: rgba(255,255,255,0.05);"><strong>Synthesist:</strong> ${esc(data.question)}</div>`;
        chat.scrollTop = chat.scrollHeight;
        if (data.isSatisfied) {
          $("interviewModal").classList.add("hidden");
        }
        playTTS(data.question);
      } else if (data.eventType === "EXECUTION_HANDOFF") {
        showToast(`Execution Handoff: ${data.status}`, data.status === "SUCCESS" ? "success" : "error");
      } else if (completedEvent) {
        try {
          const sessionData = await api(`/sessions/${id}`);
          if (sessionData.verdict) {
            const parsedVerdict = parseObject(sessionData.verdict);
            if (parsedVerdict && parsedVerdict.summary) {
              playTTS(parsedVerdict.summary);
            }
          }
        } catch (err) {
          console.error("Failed to read verdict for TTS", err);
        }
      }
      if (data.eventType === "ROLE_ACTIVATED") setSpeakingRole(data.roleId);
      if (data.eventType === "ROLE_MESSAGE") setSpeakingRole(null);
      if (completedEvent) flashCompletedTitle();
      await refresh();
      if (completedEvent) document.dispatchEvent(new CustomEvent("synod:session-complete", { detail: { sessionId: id, event: data } }));
    });
  });
  updateAvatarLayout();
  await refresh();
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function startPolling(id) {
  if (pollTimer || id !== currentSessionId) return;
  pollTimer = setInterval(async () => {
    if (id !== currentSessionId) return stopPolling();
    try {
      const session = await api(`/sessions/${id}`);
      await refresh();
      if (!isSessionRunning(session.status)) {
        stopPolling();
        if (String(session.status || "").toUpperCase() === "COMPLETED") {
          document.dispatchEvent(new CustomEvent("synod:session-complete", { detail: { sessionId: id, event: { eventType: "SESSION_COMPLETE", status: session.status } } }));
        }
        return;
      }
    } catch (error) {
      console.warn("Session polling retry failed", error);
    }
  }, 3000);
}

function stopSessionUpdates() {
  if (source) source.close();
  source = null;
  stopPolling();
}

function isSessionRunning(status) {
  return ["CREATED", "QUEUED", "INTERVIEW", "DELIBERATING", "RUNNING", "PAUSED"].includes(String(status || "").toUpperCase());
}

function parseObject(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
  } catch {
    return fallback;
  }
}

function roleName(role = {}, message = {}) {
  if (role.display_name) return role.display_name;
  if (role.role_type) return role.role_type.toLowerCase().split("_").map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ");
  if (message.model_name === "obsidian-memory") return "Obsidian Memory Architect";
  if (message.model_name === "mobile-upload") return "Mobile Upload Bridge";
  if (message.model_name === "file-attachment") return "File Attachment";
  return message.model_name || "Council Member";
}

function setSpeakingRole(roleId) {
  document.querySelectorAll(".council-role").forEach((card) => card.classList.toggle("speaking", Boolean(roleId) && card.dataset.roleId === roleId));
}

function flashCompletedTitle() {
  let flashes = 0;
  const timer = setInterval(() => {
    document.title = flashes % 2 ? originalTitle : "✦ Verdict ready - Synod";
    if (++flashes >= 8) {
      clearInterval(timer);
      document.title = originalTitle;
    }
  }, 650);
}

function launchConfetti() {
  const layer = $("confettiLayer");
  if (!layer) return;
  layer.innerHTML = Array.from({ length: 32 }, (_, index) => `<i style="--x:${(index * 37) % 100}%;--delay:${(index % 8) * 55}ms;--hue:${(index * 47) % 360}"></i>`).join("");
  setTimeout(() => { layer.innerHTML = ""; }, 2400);
}

window.downloadExecutionReport = function(encodedReport) {
  const link = document.createElement("a");
  link.href = `data:text/json;charset=utf-8,${encodedReport}`;
  link.download = "agentic-report.json";
  link.click();
};

// Inline Avatar Layout controller
function updateAvatarLayout() {
  const container = $("avatarContainer");
  if (!container) return;
  
  const welcomerVisible = !$("welcomer").classList.contains("hidden");
  if (welcomerVisible) {
    const anchor = $("avatarAnchorWelcomer");
    if (anchor && container.parentNode !== anchor) {
      anchor.appendChild(container);
      container.className = "state-welcome-inline";
    }
  } else {
    const anchor = $("avatarAnchorFeed");
    if (anchor && container.parentNode !== anchor) {
      anchor.appendChild(container);
      container.className = "state-feed-inline";
    }
  }
}

// Text-to-Speech (Speech Synthesis) for Human Avatar
let lastSpokenMessageId = null;

function speakText(text, messageId) {
  if (!window.speechSynthesis || $("avatarPlayOverlay")?.getAttribute("aria-pressed") !== "true" || lastSpokenMessageId === messageId) return;
  lastSpokenMessageId = messageId;
  
  window.speechSynthesis.cancel();
  
  // Clean text from markdown or JSON wrappers if present
  let cleanText = String(text ?? "").replace(/[*_`#]/g, "").trim();
  const sentences = cleanText.match(/[^.!?]+[.!?]+/g) || [cleanText];
  let textToSpeak = "";
  if (sentences.length <= 4) {
    textToSpeak = cleanText;
  } else {
    textToSpeak = "I have finished constructing the custom roadmap. Please review and download the detailed report in your dashboard below.";
  }
  
  const utterance = new SpeechSynthesisUtterance(textToSpeak);
  utterance.lang = speechLocale(getCurrentLang());
  
  const voices = window.speechSynthesis.getVoices();
  const targetVoice = voices.find(v => v.lang.startsWith(utterance.lang) && (v.name.includes("Google") || v.name.includes("Natural")));
  if (targetVoice) utterance.voice = targetVoice;
  
  utterance.onstart = () => {
    const video = $("avatarVideo");
    const container = $("avatarContainer");
    if (video) {
      video.muted = false;
      video.play().catch(() => {});
    }
    if (container) {
      container.classList.add("avatar-speaking");
    }
  };
  
  utterance.onend = () => {
    const video = $("avatarVideo");
    const container = $("avatarContainer");
    if (video) {
      video.muted = true;
    }
    if (container) {
      container.classList.remove("avatar-speaking");
    }
  };
  
  window.speechSynthesis.speak(utterance);
}

// Initialize layout on load
setTimeout(updateAvatarLayout, 200);

async function refresh() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
  await loadSessions();
  if (!currentSessionId) {
    updateAvatarLayout();
    return;
  }
  const [session, messages, interviewsData] = await Promise.all([
    api(`/sessions/${currentSessionId}`),
    api(`/sessions/${currentSessionId}/messages`),
    api(`/sessions/${currentSessionId}/interviews`).catch(() => ({ interviews: [] }))
  ]);
  const verdict = parseObject(session.verdict);
  currentSession = session;
  const completed = session.status === "COMPLETED";
  $("completionActions")?.classList.toggle("hidden", !completed);
  document.body.classList.toggle("session-completed", completed);
  $("status").innerText = session.status;
  
  updateAvatarLayout();
  
  // Trigger speech synthesis depending on state
  if (session.status === "INTERVIEW") {
    const turns = interviewsData.interviews || [];
    if (turns.length > 0) {
      const lastTurn = turns[turns.length - 1];
      if (lastTurn.llm_response) speakText(lastTurn.llm_response, lastTurn.id);
    }
  } else if (session.status === "COMPLETED" && verdict?.summary) {
    speakText(verdict.summary, session.id + "_verdict");
  }

  
  if (session.status === "INTERVIEW") {
    $("interviewModal").classList.remove("hidden");
  } else {
    $("interviewModal").classList.add("hidden");
  }
  
  if (session.pipeline_id) {
    $("pipelineStatus").classList.remove("hidden");
    $("pipelineStage").innerText = `Stage ${session.stage_index + 1} - ${session.status}`;
  } else {
    $("pipelineStatus").classList.add("hidden");
  }
  const currentRound = messages.messages?.length ? Math.max(...messages.messages.map(m => m.round_number)) : 0;
  $("round").innerText = session.max_rounds ? `${currentRound}/${session.max_rounds}` : "-";
  if (window.lastAnnouncedRound !== currentRound && currentRound > 0 && session.status !== "COMPLETED") {
    window.lastAnnouncedRound = currentRound;
    avatarHost.onRoundComplete(currentRound);
  }
  const consensus = Number(session.consensus);
  $("consensus").innerText = Number.isFinite(consensus) ? `${Math.round(consensus * 100)}%` : "-";
  if ($("cost")) $("cost").innerText = formatCost(session.spent_cost_usd, session.budget_limit_usd, session.estimated_cost_usd);
  renderCouncilProgress(session, messages.messages || [], currentRound, consensus);
  renderActiveContext(session);
  $("internal").innerText = session.compact_internal ? "Compact" : "Verbose";

  if (simpleModeActive) {
    let combinedHtml = "";
    
    // 1. Render all clarifications/interview turns
    const interviewTurns = interviewsData.interviews || [];
    for (const turn of interviewTurns) {
      combinedHtml += `
        ${turn.user_message ? `<div class="simple-turn user"><div class="simple-bubble">${esc(turn.user_message)}</div></div>` : ""}
        <div class="simple-turn council"><div class="simple-bubble">
          <div class="simple-speaker"><i data-lucide="help-circle"></i> Lead Synthesist · Interview</div>
          <p>${esc(turn.llm_response || "Identifying the highest-value clarification…")}</p>
        </div></div>
      `;
    }

    // 2. Render all council messages
    combinedHtml += (messages.messages || []).map((message) => {
      let payload;
      try {
        payload = JSON.parse(message.payload);
        if (typeof payload === "string") payload = JSON.parse(payload);
      } catch(e) {
        payload = { shortSummary: message.content || "Error parsing message payload." };
      }
      
      const role = session.roles.find(r => r.id === message.role_id) || {};
      const displayName = roleName(role, message);
      const icon = message.role_id ? "user" : (message.model_name === "obsidian-memory" ? "database" : (message.model_name === "mobile-upload" ? "smartphone" : "file-text"));

      let attachmentHtml = "";
      if (payload.fileUrl) {
        if (payload.fileType?.startsWith("image/")) {
          attachmentHtml = `<div style="margin-top: 8px;"><img src="${payload.fileUrl}" style="max-width: 100%; max-height: 200px; border-radius: 8px;" /></div>`;
        } else if (payload.fileType?.startsWith("audio/")) {
          attachmentHtml = `<div style="margin-top: 8px;"><audio src="${payload.fileUrl}" controls style="width: 100%;"></audio></div>`;
        } else {
          attachmentHtml = `<div style="margin-top: 8px;"><a href="${payload.fileUrl}" target="_blank" class="button" style="font-size:12px; padding:6px 12px; display: inline-flex; align-items: center; gap: 4px; text-decoration: none;"><i data-lucide="download" style="width:14px;height:14px;"></i> Download File</a></div>`;
        }
      }

      return `
        <div class="simple-turn council">
          <div class="simple-bubble">
            <div class="simple-speaker"><i data-lucide="${icon}"></i> ${esc(displayName)} <span>${esc(message.model_name)}</span></div>
            <p>${esc(safeDisplayText(payload.shortSummary || payload.summary || message.content))}</p>
            ${attachmentHtml}
            ${renderInsightSections(payload, true)}
          </div>
        </div>
      `;
    }).join("");

    $("messages").innerHTML = combinedHtml;
  } else {
    $("messages").innerHTML = (messages.messages || []).map((message) => {
      let payload;
      try {
        payload = JSON.parse(message.payload);
        if (typeof payload === "string") payload = JSON.parse(payload);
      } catch(e) {
        payload = { shortSummary: message.content || "Error parsing message payload." };
      }
      
      const role = session.roles.find(r => r.id === message.role_id) || {};
      const displayName = roleName(role, message);
      const icon = message.role_id ? "user" : (message.model_name === "obsidian-memory" ? "database" : (message.model_name === "mobile-upload" ? "smartphone" : "file-text"));

      let contentHtml = `<div class="summary">${esc(safeDisplayText(payload.shortSummary || payload.summary || message.content))}</div>`;
      
      if (payload.fileUrl) {
        if (payload.fileType?.startsWith("image/")) {
          contentHtml += `<div style="margin-top: 12px;"><img src="${payload.fileUrl}" style="max-width: 100%; max-height: 250px; border-radius: 8px; border: 1px solid var(--border);" /></div>`;
        } else if (payload.fileType?.startsWith("audio/")) {
          contentHtml += `<div style="margin-top: 12px;"><audio src="${payload.fileUrl}" controls style="width: 100%;"></audio></div>`;
        } else {
          contentHtml += `<div style="margin-top: 12px;"><a href="${payload.fileUrl}" target="_blank" class="button" style="display: inline-flex; align-items: center; gap: 6px; text-decoration: none;"><i data-lucide="download" style="width:16px;height:16px;"></i> Download File</a></div>`;
        }
      }

      contentHtml += renderInsightSections(payload);

      return `
        <div class="message-card" data-message-id="${esc(message.id || `${message.role_id}-${message.round_number}`)}">
          <div class="message-header">
            <div class="role-info">
              <div class="role-icon"><i data-lucide="${icon}" style="width: 18px; height: 18px;"></i></div>
              <div>
                <h3>${esc(displayName)}</h3>
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
  }
  if ($("researcherCount")) {
    const responseCount = messages.messages?.length || 0;
    $("researcherCount").textContent = `${responseCount} ${responseCount === 1 ? "response" : "responses"}`;
  }


  const verdictContainer = $("verdict");
  if (verdict) {
    if (window.lastAnnouncedVerdict !== session.id) {
      window.lastAnnouncedVerdict = session.id;
      avatarHost.onVerdict(verdict.summary);
      launchConfetti();
    }
    
    const warningHtml = session.warnings?.length
      ? `<div class="resilience-notice"><strong><i data-lucide="shield-check"></i> Resilience notice</strong>${session.warnings.map((warning) => `<span>${esc(friendlyWarning(warning))}</span>`).join("")}</div>`
      : "";
    let executionHtml = "";
    if (session.execution_payload) {
      try {
        const exec = JSON.parse(session.execution_payload);
        const format = exec.format || "";
        const raw = typeof exec.rawPayload === "string" ? exec.rawPayload : "";
        const renderType = exec.render_type || (session.topic.toLowerCase().includes("project") || session.topic.toLowerCase().includes("plan") || session.topic.toLowerCase().includes("deploy") ? "kanban" : "json");
        const hasTaskPayload = raw.trim().length > 3;
        
        executionHtml = renderExecutionBrief(exec);
      } catch (err) {
        console.error("Failed to parse execution payload", err);
      }
    }

    const decisionText = readableVerdictText([verdict.decision, verdict.summary, verdict.majority], ["decision", "executiveSummary", "shortSummary"]);
    const rationaleText = readableVerdictText([verdict.rationale, verdict.majority], ["executiveSummary", "rationale", "summary"]);
    verdictContainer.innerHTML = `
      <article class="verdict-hero">
        <div class="verdict-label"><i data-lucide="sparkles"></i> Council decision</div>
        <h3><i data-lucide="award"></i> ${t("final_verdict")}</h3>
        <div class="verdict-summary">${esc(decisionText || "Verdict complete")}</div>
        ${rationaleText ? `<p class="verdict-majority">${esc(rationaleText)}</p>` : ""}
        ${renderPrimaryExecutionPlan(verdict.executionPlan, session)}
        ${renderVerdictBrief(verdict)}
        ${Number.isFinite(Number(verdict.confidence)) ? `<div class="verdict-confidence"><span>Confidence</span><strong>${Math.round(Number(verdict.confidence) * 100)}%</strong></div>` : ""}
        ${warningHtml}
        ${executionHtml}
      </article>
    `;
  } else if (session.status === "AWAITING_BUDGET_APPROVAL") {
    const nextBudget = Math.max(Number(session.budget_limit_usd || 0) * 1.5, Number(session.spent_cost_usd || 0) + 0.01);
    verdictContainer.innerHTML = `<article class="decision-error budget-approval" role="alert">
      <div><i data-lucide="wallet-cards"></i><strong>Budget approval needed before Synod continues.</strong></div>
      <p>Estimated spend is ${esc(formatCurrency(session.spent_cost_usd))} of ${esc(formatCurrency(session.budget_limit_usd))}. Increase the limit only if you want this decision to continue.</p>
      <div class="budget-approval-actions"><label for="budgetApprovalInput">New cap (USD)</label><input id="budgetApprovalInput" type="number" min="0.01" step="0.01" value="${esc(String(nextBudget.toFixed(2)))}" inputmode="decimal" /><button class="button secondary" type="button" onclick="window.approveCurrentBudget()"><i data-lucide="shield-check"></i> Approve and continue</button></div>
    </article>`;
  } else if (session.status === "FAILED" || session.warnings?.some((warning) => warning.code === "SESSION_ERROR")) {
    verdictContainer.innerHTML = `<article class="decision-error" role="alert">
      <div><i data-lucide="triangle-alert"></i><strong>Synod could not produce a reliable decision.</strong></div>
      <p>The model connection stopped before a grounded answer was ready. Your question is preserved. Retry the decision or select a different provider in Settings.</p>
      <button class="button secondary" type="button" onclick="window.retryCurrentSession()"><i data-lucide="rotate-cw"></i> Retry decision</button>
    </article>`;
  } else {
    verdictContainer.innerHTML = "";
  }


  // The live council visualization replaces the old static three-dot loader.
  $("loader").classList.add("hidden");

  const msgs = $("messages");
  animateNewMessages(msgs);
  msgs.scrollTop = msgs.scrollHeight;
  if (window.lucide) window.lucide.createIcons();
  } finally {
    refreshInFlight = false;
  }
}

function formatCurrency(value) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(value || 0));
}

function formatCost(spent, limit, estimate) {
  const cost = Number(spent || 0);
  const cap = Number(limit || 0);
  const estimated = Number(estimate || 0);
  if (cost === 0 && estimated === 0) return "Included";
  if (cap > 0) return `${formatCurrency(cost)} / ${formatCurrency(cap)}`;
  return estimated > 0 ? `~${formatCurrency(estimated)}` : "Included";
}

window.approveCurrentBudget = async function approveCurrentBudget() {
  if (!currentSessionId) return;
  const value = Number($("budgetApprovalInput")?.value);
  if (!Number.isFinite(value) || value <= 0) return showToast("Enter a valid USD budget cap.", "error");
  try {
    await api(`/sessions/${currentSessionId}/budget-approval`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ budgetLimitUsd: value }) });
    showToast("Budget approved. Synod is continuing the decision.", "success");
    await refresh();
  } catch (error) {
    showToast(error.message, "error");
  }
};

function renderCouncilProgress(session, messages, currentRound, consensus) {
  const roles = session.roles || [];
  const maxRounds = Math.max(1, Number(session.max_rounds) || 1);
  const active = isSessionRunning(session.status);
  const activityToggle = $("councilActivityToggle");
  if (activityToggle) {
    activityToggle.classList.toggle("hidden", !session?.id);
    activityToggle.dataset.active = String(active);
  }
  setCouncilActivityVisible(councilActivityVisible);
  document.body.classList.toggle("session-active", active);
  document.body.classList.add("has-session");
  updateMissionRoute(session.status, Boolean(session.execution_payload));
  $("liveDeliberation").classList.toggle("hidden", !active);
  const stageLabel = currentRound <= 1 ? "Getting specialist perspectives" : currentRound === 2 ? "Testing assumptions" : currentRound < maxRounds ? "Challenging the strategy" : "Building the execution plan";
  $("deliberationLabel").textContent = active ? (advancedView ? `${stageLabel} · Round ${Math.max(1, currentRound || 1)} of ${maxRounds}` : stageLabel) : session.status;
  const spokenThisRound = new Set(messages.filter((message) => message.round_number === Math.max(1, currentRound)).map((message) => message.role_id));
  const roundProgress = roles.length ? Math.min(100, (spokenThisRound.size / roles.length) * 100) : 0;
  $("roundProgressFill").style.width = `${roundProgress}%`;
  $("roundProgressFill").parentElement.setAttribute("aria-valuenow", String(Math.round(roundProgress)));
  $("consensusFill").style.width = `${Number.isFinite(consensus) ? Math.max(0, Math.min(100, consensus * 100)) : 0}%`;
  $("roundNodes").innerHTML = Array.from({ length: maxRounds }, (_, index) => {
    const round = index + 1;
    const state = round < currentRound || session.status === "COMPLETED" ? "complete" : round === Math.max(1, currentRound) && active ? "active" : "";
    return `<span class="round-node ${state}" title="Round ${round}">${round}</span>`;
  }).join("");
  const nextSpeaker = active ? roles.find((role) => !spokenThisRound.has(role.id))?.id : null;
  $("councilRoles").innerHTML = roles.map((role, index) => `<div class="council-role ${spokenThisRound.has(role.id) ? "spoke" : ""} ${role.id === nextSpeaker ? "speaking" : ""}" data-role-id="${esc(role.id)}" style="--role-delay:${index * 70}ms"><span>${esc(roleName(role))}</span><small>${spokenThisRound.has(role.id) ? "Spoke" : role.id === nextSpeaker ? "Speaking next" : active ? "Thinking" : role.status || "Ready"}</small></div>`).join("");
}

function toneLabel(tone) {
  return {
    trusted: "Trusted friend",
    focused: "Focused",
    formal: "Formal"
  }[String(tone || "").toLowerCase()] || "Trusted friend";
}

function renderActiveContext(session) {
  const panel = $("activeContext");
  if (!panel) return;
  const visible = activeContextVisible && Boolean(session?.id);
  panel.classList.toggle("hidden", !visible);
  if (!visible) return;

  const outcome = String(session.desired_outcome || companionDefaultOutcome || "A clear, evidence-aware next step I can act on.").trim();
  const brief = String(session.persona_brief || companionPersonaBrief || "").trim();
  const mode = session.pipeline_id ? "Guided council" : "Direct decision";
  const memory = Number(session.use_memory) === 0
    ? "Excluded for this decision"
    : "Relevant saved decisions may be used";
  const rows = [
    ["Persona", toneLabel(session.tone)],
    ["Working toward", outcome],
    ["Council mode", mode],
    ["Saved context", memory]
  ];
  if (brief) rows.push(["Companion brief", brief]);

  $("activeContextSummary").textContent = `${toneLabel(session.tone)} · ${outcome}`;
  $("activeContextDetails").innerHTML = rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("");
}

function updateMissionRoute(status, hasExecutionPayload = false) {
  const normalized = String(status || "").toUpperCase();
  const stage = normalized === "COMPLETED"
    ? (hasExecutionPayload ? "execute" : "decide")
    : ["DELIBERATING", "RUNNING", "PAUSED"].includes(normalized)
      ? "deliberate"
      : "interview";
  const stages = ["interview", "deliberate", "decide", "execute"];
  const activeIndex = stages.indexOf(stage);
  document.body.dataset.missionStage = stage;
  document.querySelectorAll(".route-stop").forEach((stop, index) => {
    stop.classList.toggle("active", index === activeIndex);
    stop.classList.toggle("complete", index < activeIndex || (stage === "execute" && index === activeIndex));
  });
}

function animateNewMessages(container) {
  container.querySelectorAll("[data-message-id]").forEach((card) => {
    const id = card.dataset.messageId;
    if (renderedMessageIds.has(id)) return;
    renderedMessageIds.add(id);
    card.classList.add("message-enter");
    const summary = card.querySelector(".summary");
    if (!summary || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const text = summary.textContent;
    if (text.length > 500) return;
    summary.textContent = "";
    let cursor = 0;
    const type = () => {
      summary.textContent = text.slice(0, cursor += 3);
      if (cursor < text.length) requestAnimationFrame(type);
    };
    requestAnimationFrame(type);
  });
}

async function loadSessions() {
  if (!$("sessions")) return;
  const { sessions } = await api("/sessions?state=active");
  $("sessions").innerHTML = sessions.map((session) => `<button class="item" data-id="${session.id}"><b>${esc(session.topic)}</b><p>${esc(session.status)} · ${t("round")} ${session.current_round}</p></button>`).join("") || `<p>${t("no_sessions")}</p>`;
  $("sessions").querySelectorAll("[data-id]").forEach((button) => button.addEventListener("click", () => selectSession(button.dataset.id)));
}

async function loadCouncils() {
  const [{ councils }, { workspaces }] = await Promise.all([api("/councils"), api("/workspaces")]);
  $("councilList").innerHTML = councils.map((council) => `<div class="item"><b>${esc(council.name)}</b><p>${esc(council.description)} · ${JSON.parse(council.role_manifest).length} roles</p></div>`).join("") || `<p>${t("no_councils")}</p>`;
  const councilOpts = `<option value="">Dynamic Council</option>` + councils.map((council) => `<option value="${council.id}">${esc(council.name)}</option>`).join("");
  $("councilSelect").innerHTML = councilOpts;
  if ($("mainCouncilSelect")) $("mainCouncilSelect").innerHTML = councilOpts;

  const manifest = safeJson($("manifest").value, []);
  const ids = manifest.map((role) => role.workspace_id).filter(Boolean);
  if ($("workspacePreview")) {
    $("workspacePreview").textContent = ids.length
      ? ids.map((workspaceId) => workspaces.some((workspace) => workspace.id === workspaceId || workspace.external_id === workspaceId) ? `${workspaceId}: available` : `${workspaceId}: not found, fallback will bind by similarity`).join("\n")
      : "No pre-bound workspace IDs in this manifest.";
  }
}

function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

async function loadHistory() {
  const { conversations } = await api(`/conversations?state=${sessionListState}`);
  const query = $("sessionSearch")?.value.trim().toLocaleLowerCase(getCurrentLang()) || "";
  const filtered = conversations.filter((conversation) => !query || String(conversation.title).toLocaleLowerCase(getCurrentLang()).includes(query));
  $("historyList").innerHTML = filtered.map((conversation) => {
    return `<article class="item session-item" data-conversation-id="${conversation.id}">
      <button class="session-open" type="button" data-open-session="${conversation.latest_session_id || ""}"><span><b>${esc(conversation.title)}</b><small>${conversation.session_count} ${t("sessions")} · ${new Intl.DateTimeFormat(getCurrentLang(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(conversation.last_activity_at || conversation.updated_at))}</small></span><i data-lucide="chevron-right"></i></button>
      <div class="session-actions"><button class="icon-button" type="button" data-session-action="rename" data-conversation-id="${conversation.id}" data-title="${esc(conversation.title)}" aria-label="Rename"><i data-lucide="pencil"></i></button><a class="icon-button" href="/api/v1/conversations/${conversation.id}/export" aria-label="Export"><i data-lucide="download"></i></a><button class="button session-lifecycle" type="button" data-lifecycle="${sessionListState === "archived" ? "restore" : "archive"}" data-conversation-id="${conversation.id}"><i data-lucide="${sessionListState === "archived" ? "archive-restore" : "archive"}"></i><span>${t(sessionListState === "archived" ? "restore" : "archive")}</span></button><button class="icon-button danger-button" type="button" data-session-action="delete" data-conversation-id="${conversation.id}" aria-label="Delete permanently"><i data-lucide="trash-2"></i></button></div>
    </article>`;
  }).join("") || `<p class="empty-session-list">${t(sessionListState === "archived" ? "no_archived_sessions" : "no_active_sessions")}</p>`;
  $("historyList").querySelectorAll("[data-open-session]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.openSession) { closeDrawers(); void selectSession(button.dataset.openSession); }
  }));
  $("historyList").querySelectorAll("[data-lifecycle]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.lifecycle;
    button.disabled = true;
    await api(`/conversations/${button.dataset.conversationId}/${action}`, { method: "POST" });
    showToast(t(action === "archive" ? "archive_success" : "restore_success"), "success", action === "archive" ? { label: "Undo", run: async () => { await api(`/conversations/${button.dataset.conversationId}/restore`, { method: "POST" }); await loadHistory(); } } : null);
    if (action === "archive" && currentSession?.conversation_id === button.dataset.conversationId) resetConversation({ preserveDraft: true });
    await loadHistory();
  }));
  $("historyList").querySelectorAll("[data-session-action]").forEach((button) => button.addEventListener("click", async () => {
    const id = button.dataset.conversationId;
    if (button.dataset.sessionAction === "rename") {
      const title = window.prompt("Rename conversation", button.dataset.title || "");
      if (title == null) return;
      await api(`/conversations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    } else {
      if (!window.confirm("Permanently delete this conversation and its sessions? This cannot be undone.")) return;
      await api(`/conversations/${id}`, { method: "DELETE" });
      if (currentSession?.conversation_id === id) resetConversation();
    }
    await loadHistory();
  }));
  if (window.lucide) window.lucide.createIcons();
}

document.querySelectorAll("[data-session-state]").forEach((button) => button.addEventListener("click", () => {
  sessionListState = button.dataset.sessionState;
  document.querySelectorAll("[data-session-state]").forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", String(active));
  });
  void loadHistory();
}));
$("sessionSearch")?.addEventListener("input", () => void loadHistory());

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
    const verdict = parseObject(session.verdict);
    if (verdict) {
      if (window.lastAnnouncedVerdict !== session.id) {
        window.lastAnnouncedVerdict = session.id;
        avatarHost.onVerdict(verdict.summary);
      }
      const historyDecision = readableVerdictText([verdict.decision, verdict.summary, verdict.majority], ["decision", "executiveSummary", "shortSummary"]);
      const historyRationale = readableVerdictText([verdict.rationale, verdict.majority], ["executiveSummary", "rationale", "summary"]);
      verdictHtml = `<article class="verdict-hero history-verdict">
        <div class="verdict-kicker"><i data-lucide="award"></i> Council decision</div>
        <div class="verdict-summary">${esc(historyDecision || "Verdict complete")}</div>
        ${historyRationale ? `<p class="verdict-majority">${esc(historyRationale)}</p>` : ""}
        ${renderVerdictBrief(verdict)}
      </article>`;
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
      contentHtml += renderInsightSections(payload);

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
  document.dispatchEvent(new CustomEvent("synod:language-changed"));
  loadSessions();
  loadCouncils();
  loadHistory();
  if (currentSessionId) refresh();
});

loadSessions();
loadCouncils();

// Tab switching is handled by the drawer-based handler above (line ~37)

function renderInsightSections(payload, compact = false) {
  const sections = [
    ["Decision", payload.decision ? [payload.decision] : [], "compass"],
    ["Rationale", payload.rationale ? [payload.rationale] : [], "lightbulb"],
    ["Key findings", payload.keyClaims, "check-circle-2"],
    ["Evidence", payload.evidence, "book-open-check"],
    ["Risks", payload.risks, "shield-alert"],
    ["Recommended actions", payload.recommendedActions || payload.nextSteps, "list-checks"],
    ["Alternatives", payload.alternatives, "git-branch"],
    ["Assumptions", payload.assumptions, "circle-dashed"],
    ["Open questions", payload.openQuestions?.length ? payload.openQuestions : payload.knowledgeGaps, "circle-help"],
    ["Disagreements", payload.disagreements, "message-square-warning"]
  ].filter(([, values]) => Array.isArray(values) && values.length);
  if (!sections.length) return "";
  return `<div class="insight-grid ${compact ? "compact" : ""}">${sections.map(([title, values, icon]) => `
    <section class="insight-block">
      <h4><i data-lucide="${icon}"></i>${esc(title)}</h4>
      <ul>${values.slice(0, compact ? 3 : 6).map((value) => `<li>${formatInsight(value)}</li>`).join("")}</ul>
    </section>`).join("")}</div>`;
}

function renderVerdictBrief(verdict) {
  const groups = [
    ["Recommended actions", verdict.recommendedActions, "list-checks"],
    ["Success measures", verdict.successMetrics, "chart-no-axes-combined"],
    ["Guardrails", verdict.guardrails, "shield-check"],
    ["Key risks", verdict.risks, "triangle-alert"],
    ["Alternatives considered", verdict.alternatives, "git-compare"],
    ["Open questions", verdict.openQuestions, "circle-help"]
  ].filter(([, values]) => Array.isArray(values) && values.length);
  if (!groups.length) return "";
  return `<div class="decision-brief">${groups.map(([title, values, icon]) => `
    <section class="decision-section">
      <h4><i data-lucide="${icon}"></i>${esc(title)}</h4>
      <ol>${values.slice(0, 6).map((value) => `<li>${formatInsight(value)}</li>`).join("")}</ol>
    </section>`).join("")}</div>`;
}

function renderPrimaryExecutionPlan(plan, session) {
  if (!plan?.phases?.length) return "";
  const readiness = plan.readiness || {};
  const ownerItems = [
    ...(plan.ownerInvolvement?.informationRequired || []).map((item) => ({ type: "Information required", item })),
    ...(plan.ownerInvolvement?.approvalRequired || []).map((item) => ({ type: "Approval required", item }))
  ];
  return `<section class="primary-plan" aria-labelledby="executionPlanTitle">
    <div class="primary-plan-head"><div><h3 id="executionPlanTitle">Execution plan</h3><p>Version ${esc(String(session?.verdict?.planVersion || 1))} · ready for a human team or future executor handoff</p></div><div class="readiness-score"><strong>${esc(String(readiness.overall || 0))}%</strong><span>ready to start</span></div></div>
    <div class="first-actions"><h4>What happens first</h4><ol>${(plan.firstActions || []).slice(0, 3).map((item) => `<li>${formatInsight(item)}</li>`).join("")}</ol></div>
    <div class="phase-list">${plan.phases.map((phase) => `<details class="plan-phase" ${phase.order === 1 ? "open" : ""}><summary><span><b>${esc(phase.name)}</b><small>${esc(phase.duration)} · ${esc(phase.owner)}</small></span><i data-lucide="chevron-down"></i></summary><p>${esc(phase.objective)}</p><div class="phase-columns"><div><h4>Tasks</h4><ol>${phase.tasks.map((item) => `<li>${formatInsight(item)}</li>`).join("")}</ol></div><div><h4>Acceptance criteria</h4><ul>${phase.acceptanceCriteria.length ? phase.acceptanceCriteria.map((item) => `<li>${formatInsight(item)}</li>`).join("") : "<li>Owner must define measurable acceptance criteria before work begins.</li>"}</ul></div></div><div class="phase-gate"><strong>Decision gate</strong><span>${esc(phase.decisionGate)}</span><small>${esc(phase.stopContinueScaleCriteria)}</small></div></details>`).join("")}</div>
    ${ownerItems.length ? `<div class="owner-decisions"><h4>I need from you</h4>${ownerItems.map(({ type, item }) => `<div><span>${esc(type)}</span>${formatInsight(item)}</div>`).join("")}</div>` : ""}
    <div class="plan-actions"><button class="button" type="button" onclick="window.copyExecutionPlan('${esc(session.id)}')"><i data-lucide="copy"></i> Copy plan</button><a class="button" href="/api/v1/sessions/${encodeURIComponent(session.id)}/execution-plan.md" download><i data-lucide="download"></i> Download Markdown</a><button class="button advanced-only" type="button" onclick="window.copyExecutorHandoff('${esc(session.id)}')"><i data-lucide="braces"></i> Copy executor handoff</button></div>
  </section>`;
}

window.copyExecutorHandoff = async function(sessionId) {
  const record = await api(`/sessions/${encodeURIComponent(sessionId)}/execution-plan`);
  await navigator.clipboard.writeText(JSON.stringify(record.executorHandoff, null, 2));
  showToast("Executor handoff copied. Execution remains unauthorized.", "success");
};

window.copyExecutionPlan = async function(sessionId) {
  const response = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/execution-plan.md`);
  if (!response.ok) throw new Error("Plan export is unavailable.");
  await navigator.clipboard.writeText(await response.text());
  showToast("Execution plan copied as Markdown.", "success");
};

function renderExecutionBrief(execution) {
  let payload = execution.rawPayload;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { payload = null; }
  }
  const display = payload && typeof payload === "object" ? payload : execution;
  const entries = Object.entries(display).filter(([key, value]) => {
    if (["rawPayload", "render_type", "compact", "roundNumber", "confidenceScore", "flags", "dissent", "veto"].includes(key)) return false;
    if (value == null || value === "") return false;
    if (Array.isArray(value) && !value.length) return false;
    if (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length) return false;
    return true;
  });
  const title = String(execution.summary || execution.shortSummary || "");
  if (!entries.length || /master orchestrator completed|independent position review|execution framework/i.test(title)) return "";
  const encodedReport = encodeURIComponent(JSON.stringify(execution, null, 2)).replace(/'/g, "%27");
  return `<details class="execution-disclosure">
    <summary><i data-lucide="list-todo"></i> View implementation plan</summary>
    <div class="execution-head">
      <h4>${esc(title || "Implementation plan")}</h4>
      <button class="button secondary" onclick="window.downloadExecutionReport('${encodedReport}')"><i data-lucide="download"></i> Export plan</button>
    </div>
    <div class="structured-fields">${entries.slice(0, 12).map(([key, value]) => `
      <div class="structured-field"><span>${esc(humanLabel(key))}</span>${renderStructuredValue(value)}</div>`).join("")}</div>
  </details>`;
}

function renderStructuredValue(value) {
  if (Array.isArray(value)) return `<ul>${value.slice(0, 10).map((item) => `<li>${formatInsight(item)}</li>`).join("")}</ul>`;
  if (value && typeof value === "object") return `<dl>${Object.entries(value).slice(0, 10).map(([key, item]) => `<div><dt>${esc(humanLabel(key))}</dt><dd>${formatInsight(item)}</dd></div>`).join("")}</dl>`;
  return `<p>${esc(value)}</p>`;
}

function formatInsight(value) {
  if (value == null) return "";
  if (typeof value !== "object") return esc(safeDisplayText(String(value).replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")));
  const priority = value.priority ? `<span class="mini-tag">${esc(value.priority)}</span>` : "";
  const headline = value.title || value.action || value.risk || value.option || value.metric || value.claim || value.name || value.summary;
  const details = value.rationale || value.mitigation || value.description || value.target || value.evidence || value.impact;
  if (headline) return `${priority}<strong>${esc(safeDisplayText(headline))}</strong>${details ? `<span>${esc(safeDisplayText(details))}</span>` : ""}`;
  return Object.entries(value).slice(0, 4).map(([key, item]) => `<span><b>${esc(humanLabel(key))}:</b> ${esc(safeDisplayText(Array.isArray(item) ? item.join(", ") : item))}</span>`).join(" ");
}

function humanLabel(value) {
  return String(value).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function friendlyWarning(warning) {
  const message = String(warning?.message || "");
  if (/abort|timeout|timed out|provider fallback/i.test(message) || warning?.code === "PROVIDER_FALLBACK") {
    return "One model response timed out. Synod completed the decision using the remaining structured council evidence.";
  }
  if (/unstructured|json/i.test(message)) {
    return "One model returned an unstructured response. Synod normalized it before display.";
  }
  return "A provider response was degraded, so Synod used its validated fallback path.";
}

function readableVerdictText(candidates, preferredKeys) {
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const source = candidate.trim();
    try {
      const parsed = JSON.parse(source);
      for (const key of preferredKeys) {
        if (typeof parsed?.[key] === "string" && parsed[key].trim()) return parsed[key].trim();
      }
    } catch {}
    for (const key of preferredKeys) {
      const match = source.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i"));
      if (!match) continue;
      try { return JSON.parse(`"${match[1]}"`).trim(); } catch { return match[1].trim(); }
    }
    if (!/^\s*[\[{]/.test(source) && !/^"?\w+"?\s*:/.test(source)) return source;
  }
  return "";
}

function parseTasksFromPayload(raw) {
  const todo = [];
  const inProgress = [];
  const done = [];
  
  const lines = raw.split("\n");
  for (const line of lines) {
    const cleaned = line.replace(/^[-*+\s\d.]+|\[[ xX/]*\]/g, "").trim();
    if (!cleaned || /^(?:\.{2,}|null|undefined|none|\{\}|\[\])$/i.test(cleaned)) continue;
    
    if (line.includes("[ ]") || line.toLowerCase().includes("todo") || line.toLowerCase().includes("to-do")) {
      todo.push(cleaned);
    } else if (line.includes("[/]") || line.toLowerCase().includes("progress") || line.toLowerCase().includes("doing")) {
      inProgress.push(cleaned);
    } else if (line.includes("[x]") || line.includes("[X]") || line.toLowerCase().includes("done") || line.toLowerCase().includes("complete")) {
      done.push(cleaned);
    } else {
      todo.push(cleaned);
    }
  }
  
  return { todo, inProgress, done };
}

window.retryCurrentSession = async () => {
  if (!currentSessionId) return;
  $("loader").classList.remove("hidden");
  try {
    await api(`/sessions/${currentSessionId}/start`, { method: "POST" });
    await refresh();
  } catch (error) {
    showToast(error.message || "Unable to retry this decision.", "error");
  } finally {
    $("loader").classList.add("hidden");
  }
};

// Supporting evidence is optional. The verdict stays the primary answer.
$("simpleModeToggle").addEventListener("click", () => {
  const research = $("researchStream");
  const isVisible = !research.classList.contains("hidden");
  research.classList.toggle("hidden", isVisible);
  $("simpleModeToggle").innerHTML = isVisible
    ? '<i data-lucide="book-open-text"></i><span>Supporting notes</span>'
    : '<i data-lucide="x"></i><span>Hide notes</span>';
  $("simpleModeToggle").setAttribute("aria-pressed", String(!isVisible));
  $("simpleModeToggle").title = isVisible ? "Show supporting notes" : "Hide supporting notes";
  if (window.lucide) window.lucide.createIcons();
});

// File Upload Integration
function setupFileInput(btnId, inputId) {
  const btn = $(btnId);
  const fileInput = $(inputId);
  if (!btn || !fileInput) return;
  
  btn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      attachedFile = {
        fileName: file.name,
        fileType: file.type,
        fileData: event.target.result
      };
      setContextAttachmentLabel(file.name);
      showToast(`Attached file: ${file.name}`, "success");
    };
    reader.readAsDataURL(file);
  });
}

function setContextAttachmentLabel(fileName = "") {
  const button = $("mainTopicFileBtn");
  if (!button) return;
  const label = button.querySelector("span");
  button.classList.toggle("is-attached", Boolean(fileName));
  button.title = fileName ? `Context ready: ${fileName}` : "Add context or knowledge";
  if (label) label.textContent = fileName ? "Context ready" : "Add context";
}

setupFileInput("mainTopicFileBtn", "mainTopicFileInput");
setupFileInput("mainFeedFileBtn", "mainFeedFileInput");

// Unified Composer Logic
async function handleUnifiedSubmit() {
  const input = $("mainTopicInput").value.trim();
  if (!input) return;
  
  const currentSessionStatus = $("status").innerText.toLowerCase();
  
  if (currentSessionId && currentSessionStatus === "interview") {
    // Reply to interview
    $("mainTopicInput").value = "";
    $("loader").classList.remove("hidden");
    try {
      const payload = { message: input };
      if (attachedFile) {
        payload.fileName = attachedFile.fileName;
        payload.fileType = attachedFile.fileType;
        payload.fileData = attachedFile.fileData;
        attachedFile = null;
        setContextAttachmentLabel();
      }
      await api(`/sessions/${currentSessionId}/interview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      await refresh();
      document.dispatchEvent(new CustomEvent("synod:message-sent"));
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      $("loader").classList.add("hidden");
    }
  } else if (!currentSessionId || ["completed", "failed"].includes(currentSessionStatus)) {
    if (currentSession?.status === "COMPLETED" && !nextMessageMode) {
      $("completionActions")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return showToast(t("choose_next_step"), "error");
    }
    const hadCompletedSession = Boolean(currentSessionId);
    const isSuperbrain = $("mainSuperbrain")?.checked ?? false;
    const payload = {
      topic: input,
      ...decisionTuning(),
      councilId: $("mainCouncilSelect")?.value || undefined,
      compactInternalCommunication: $("mainCompact")?.checked ?? true,
      allowWebSearch: $("mainWeb")?.checked ?? true,
      allowRag: $("mainRag")?.checked ?? true,
      tone: $("mainTone")?.value || "trusted",
      useMemory: $("mainMemory")?.checked ?? true,
      desiredOutcome: $("mainOutcome")?.value.trim() || companionDefaultOutcome,
      personaBrief: companionPersonaBrief,
      budgetLimitUsd: $("mainBudget")?.value || undefined,
      conversationId: nextMessageMode === "continue" ? currentSession?.conversation_id : undefined,
      followUpTo: nextMessageMode === "continue" && currentSession?.status === "COMPLETED" ? currentSession.id : undefined,
      autoStart: !isSuperbrain
    };
    $("chatFeed").classList.remove("hidden");
    $("welcomer").classList.add("hidden");
    $("mainTopicInput").value = "";
    avatarHost.onSessionStart();
    try {
      await createAndSelectSession(payload, isSuperbrain);
      document.dispatchEvent(new CustomEvent("synod:message-sent"));
    } catch (error) {
      $("mainTopicInput").value = input;
      $("chatFeed").classList.toggle("hidden", !hadCompletedSession);
      $("welcomer").classList.toggle("hidden", hadCompletedSession);
      showToast(error.message, "error");
    }
  }
}

function resetConversation({ preserveDraft = false } = {}) {
  stopSessionUpdates();
  window.speechSynthesis?.cancel();
  currentSessionId = null;
  currentSession = null;
  nextMessageMode = "fresh";
  renderedMessageIds.clear();
  document.body.classList.remove("has-session", "session-active", "session-completed", "show-council-activity");
  $("chatFeed")?.classList.add("hidden");
  $("completionActions")?.classList.add("hidden");
  $("emptyCouncil")?.classList.remove("hidden");
  if ($("verdict")) $("verdict").innerHTML = "";
  if ($("messages")) $("messages").innerHTML = "";
  if ($("status")) $("status").textContent = t("idle");
  if (!preserveDraft && $("mainTopicInput")) $("mainTopicInput").value = "";
  $("transcript")?.classList.add("disabled");
  $("phoneUploadToggle")?.classList.add("hidden");
  $("welcomer")?.classList.remove("hidden");
  setCouncilActivityVisible(false);
  updateMissionRoute("CREATED", false);
  updateAvatarLayout();
  $("mainTopicInput")?.focus();
}

function requestFreshConversation() {
  const hasContext = Boolean(currentSessionId || $("mainTopicInput")?.value.trim());
  if (hasContext && $("freshConversationDialog")?.showModal) $("freshConversationDialog").showModal();
  else resetConversation();
}

$("newConversationBtn")?.addEventListener("click", requestFreshConversation);
$("confirmFreshBtn")?.addEventListener("click", () => resetConversation({ preserveDraft: Boolean($("mainTopicInput")?.value.trim()) }));
$("startFreshBtn")?.addEventListener("click", () => {
  nextMessageMode = "fresh";
  $("completionActions")?.classList.add("hidden");
  showToast(t("fresh_context"), "success");
  $("mainTopicInput")?.focus();
});
$("continueConversationBtn")?.addEventListener("click", () => {
  nextMessageMode = "continue";
  $("completionActions")?.classList.add("hidden");
  showToast(t("continuing_context"), "success");
  $("mainTopicInput")?.focus();
});
$("archiveConversationBtn")?.addEventListener("click", async () => {
  if (!currentSession?.conversation_id) return;
  await api(`/conversations/${currentSession.conversation_id}/archive`, { method: "POST" });
  showToast(t("archive_success"), "success");
  resetConversation();
});

$("mainConveneBtn").addEventListener("click", handleUnifiedSubmit);
$("mainTopicInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleUnifiedSubmit();
  }
});

// Local-first companion dictation. Audio is sent as bounded, ordered segments;
// silence stops capture into review and never submits without confirmation.
function setupSpeechRecognition(buttonId, textareaId) {
  const btn = $(buttonId);
  const txt = $(textareaId);
  if (!btn || !txt) return;

  const MIN_AUDIO_MS = 900;
  const VOICE_RMS_THRESHOLD = 0.014;
  const DEFAULT_AUDIO_SAMPLE_RATE = 48000;
  const REQUEST_TIMEOUT_MS = 15000;
  const FINAL_REQUEST_TIMEOUT_MS = 90000;
  const MAX_AUDIO_MS = 55000;
  const START_LEAD_IN_MS = 450;
  const SILENCE_AUTO_SEND_MS = 5000;
  const STREAM_FINAL_TIMEOUT_MS = 120000;
  const AUTO_SUBMIT_DELAY_MS = 900;
  const VOICE_BATCH_MIN_WORDS = 3;
  const VOICE_BATCH_MIN_CHARS = 8;
  const status = $("mainDictationStatus");
  const cancelBtn = $("cancelRecordingBtn");
  const retryBtn = $("retryVoiceBtn");
  const diagnosticsBtn = $("voiceDiagnosticsBtn");
  const diagnostics = $("voiceDiagnostics");
  let voiceState = "checking";
  let readiness = null;
  let isCapturing = false;
  let audioStream = null;
  let microphoneSource = null;
  let pcmProcessor = null;
  let pcmSilence = null;
  let mediaRecorder = null;
  let mediaChunks = [];
  let finalAudioBlob = null;
  let pcmChunks = [];
  let pcmSampleCount = 0;
  let pcmSampleRate = 0;
  let liveTimer = null;
  let activeController = null;
  let streamSocket = null;
  let streamFinalPromise = null;
  let resolveStreamFinal = null;
  let rejectStreamFinal = null;
  let streamFinalRequested = false;
  let streamSessionId = "";
  let streamConnected = false;
  let browserRecognition = null;
  let browserRecognitionActive = false;
  let browserRecognitionAvailable = false;
  let browserFinalTranscript = "";
  let browserInterimTranscript = "";
  let browserRecognitionConfidence = null;
  let browserRecognitionSuppressed = false;
  let serverFinalTranscript = "";
  let finalTranscriptSource = "";
  let finalModelName = "";
  let finalQuality = "";
  let audioContext = null;
  let captureTimeout = null;
  let autoSubmitTimer = null;
  let autoSubmitQueued = false;
  let startedAt = 0;
  let lastVoiceAt = 0;
  let heardVoice = false;
  let isStopping = false;
  let lastLevel = 0;
  let peakLevel = 0;
  let lastDiagnostics = {};
  let originalText = "";
  let committedTranscript = "";
  let liveTranscriptParts = [];
  let liveSegmentStartSample = 0;
  let livePreviewSeen = false;
  let livePreviewText = "";
  let finalDraftWriteSuppressed = false;
  let voiceBatchQueue = [];
  let voiceBatchSubmitting = false;
  let voiceBatchSubmittedCount = 0;
  let voiceBatchConversationId = "";
  let voiceBatchFollowUpSessionId = "";
  let voiceBatchLastFingerprint = "";

  const stateMessage = (state) => ({
    checking: t("voice_checking"), warming: t("voice_warming"), ready: t("voice_ready"),
    listening: t("voice_listening_live"), live_transcribing: t("voice_live_transcribing"),
    transcribing: t("voice_transcribing"), review: t("voice_review"), auto_submitting: t("voice_auto_sending"), unavailable: t("voice_unavailable"),
    cancelled: t("voice_cancelled")
  }[state] || t("voice_unavailable"));

  const renderState = (state, message = stateMessage(state)) => {
    voiceState = state;
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-listening", state === "listening");
    status.classList.toggle("is-error", state === "unavailable" || state === "error");
    document.body.dataset.voiceState = state;
    btn.disabled = ["checking", "transcribing", "auto_submitting"].includes(state);
    btn.setAttribute("aria-pressed", String(state === "listening"));
    btn.setAttribute("aria-label", state === "listening" ? t("stop_recording") : state === "review" ? t("record_again") : t("talk"));
    btn.innerHTML = state === "listening"
      ? `<i data-lucide="square"></i><span>${t("stop_recording")}</span>`
      : `<i data-lucide="mic"></i><span>${state === "review" ? t("record_again") : t("talk")}</span>`;
    cancelBtn?.classList.toggle("hidden", !["listening", "transcribing", "review", "auto_submitting"].includes(state));
    retryBtn?.classList.toggle("hidden", state !== "unavailable" && state !== "error");
    const submitLabel = $("mainConveneBtn")?.querySelector("span");
    if (submitLabel) submitLabel.textContent = state === "review" ? t("send_transcript") : t("ask_synod");
    if ($("mainConveneBtn")) $("mainConveneBtn").disabled = ["checking", "listening", "transcribing", "auto_submitting"].includes(state);
    if (window.lucide) window.lucide.createIcons();
  };

  const captureSeconds = () => pcmSampleRate ? pcmSampleCount / pcmSampleRate : 0;

  const formatDuration = (seconds) => {
    const total = Math.max(0, Math.floor(seconds || 0));
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(total % 60).padStart(2, "0")}`;
  };

  const audioLevelPercent = () => Math.max(0, Math.min(100, Math.round((lastLevel / 0.06) * 100)));

  const publishDiagnostics = (patch = {}) => {
    const mediaBytes = mediaChunks.reduce((sum, chunk) => sum + (chunk?.size || 0), 0);
    lastDiagnostics = {
      state: voiceState,
      secureContext: window.isSecureContext,
      mediaDevices: Boolean(navigator.mediaDevices),
      selectedLanguage: $("voiceInputLanguage")?.value || "auto",
      recorderState: mediaRecorder?.state || "none",
      recorderMime: mediaRecorder?.mimeType || "",
      mediaChunks: mediaChunks.length,
      mediaBytes,
      streamConnected,
      streamSessionId,
      streamFinalRequested,
      browserRecognitionAvailable,
      browserRecognitionActive,
      browserRecognitionConfidence,
      browserRecognitionSuppressed,
      browserInterimTranscript: browserInterimTranscript.slice(0, 160),
      serverFinalTranscript: serverFinalTranscript.slice(0, 160),
      finalSource: finalTranscriptSource,
      finalModelName,
      finalQuality,
      autoSubmitQueued,
      pcmSampleRate,
      pcmSamples: pcmSampleCount,
      pcmSeconds: Number(captureSeconds().toFixed(2)),
      elapsedSeconds: startedAt ? Number(((Date.now() - startedAt) / 1000).toFixed(2)) : 0,
      heardVoice,
      currentRms: Number(lastLevel.toFixed(5)),
      peakRms: Number(peakLevel.toFixed(5)),
      livePreviewSeen,
      livePreviewText: livePreviewText.slice(0, 160),
      voiceBatchQueueLength: voiceBatchQueue.length,
      voiceBatchSubmitting,
      voiceBatchSubmittedCount,
      voiceBatchConversationId,
      readiness,
      ...patch
    };
    window.__synodVoiceDebug = lastDiagnostics;
    if (diagnostics) diagnostics.textContent = JSON.stringify(lastDiagnostics, null, 2);
    return lastDiagnostics;
  };

  const clearAutoSubmit = () => {
    clearTimeout(autoSubmitTimer);
    autoSubmitTimer = null;
    autoSubmitQueued = false;
  };

  const normalizeTranscript = (value) => String(value || "").replace(/\s+/g, " ").trim();

  const writeTranscriptDraft = (transcript) => {
    const clean = normalizeTranscript(transcript);
    txt.value = `${originalText}${originalText && clean ? " " : ""}${clean}`.trim();
    return clean;
  };

  const transcriptFingerprint = (value) => normalizeTranscript(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

  const liveBatchQueuedOrSent = () => voiceBatchQueue.length > 0 || voiceBatchSubmittedCount > 0 || voiceBatchSubmitting;

  const canSubmitVoiceBatchNow = () => {
    if (!currentSessionId) return true;
    const statusText = currentSession?.status || $("status")?.innerText || "";
    return !isSessionRunning(statusText);
  };

  const buildVoiceBatchPayload = (topic) => {
    if (!voiceBatchConversationId && currentSession?.conversation_id && (isSessionRunning(currentSession.status) || nextMessageMode === "continue")) {
      voiceBatchConversationId = currentSession.conversation_id;
      voiceBatchFollowUpSessionId = currentSession.id || "";
    }
    const followUpTo = voiceBatchConversationId && currentSession?.conversation_id === voiceBatchConversationId && currentSession?.status === "COMPLETED"
      ? currentSession.id
      : voiceBatchFollowUpSessionId || undefined;
    return {
      topic,
      ...decisionTuning(),
      councilId: $("mainCouncilSelect")?.value || undefined,
      compactInternalCommunication: $("mainCompact")?.checked ?? true,
      allowWebSearch: $("mainWeb")?.checked ?? true,
      allowRag: $("mainRag")?.checked ?? true,
      tone: $("mainTone")?.value || "trusted",
      useMemory: $("mainMemory")?.checked ?? true,
      desiredOutcome: $("mainOutcome")?.value.trim() || companionDefaultOutcome,
      personaBrief: companionPersonaBrief,
      budgetLimitUsd: $("mainBudget")?.value || undefined,
      conversationId: voiceBatchConversationId || undefined,
      followUpTo,
      autoStart: true
    };
  };

  const flushVoiceBatchQueue = async () => {
    if (voiceBatchSubmitting || !voiceBatchQueue.length || !canSubmitVoiceBatchNow()) {
      publishDiagnostics({ voiceBatchFlush: "waiting" });
      return;
    }
    voiceBatchSubmitting = true;
    const batch = voiceBatchQueue.shift();
    publishDiagnostics({ voiceBatchFlush: "submitting", voiceBatchSource: batch.source, voiceBatchCharacters: batch.text.length });
    try {
      $("chatFeed")?.classList.remove("hidden");
      $("welcomer")?.classList.add("hidden");
      avatarHost.onSessionStart();
      const session = await createAndSelectSession(buildVoiceBatchPayload(batch.text), false);
      voiceBatchSubmittedCount += 1;
      voiceBatchConversationId = session?.conversation_id || voiceBatchConversationId || "";
      voiceBatchFollowUpSessionId = session?.id || voiceBatchFollowUpSessionId;
      showToast(t("voice_batch_sent"), "success");
      document.dispatchEvent(new CustomEvent("synod:voice-batch-sent", { detail: { sessionId: session?.id, source: batch.source } }));
      publishDiagnostics({ voiceBatchFlush: "submitted", voiceBatchSessionId: session?.id, voiceBatchConversationId });
    } catch (error) {
      voiceBatchQueue.unshift(batch);
      publishDiagnostics({ voiceBatchFlush: "failed", voiceBatchError: error.message });
      renderState("error", error.message || t("voice_unavailable"));
    } finally {
      voiceBatchSubmitting = false;
      if (voiceBatchQueue.length && canSubmitVoiceBatchNow()) void flushVoiceBatchQueue();
    }
  };

  const queueVoiceBatch = (text, source = "live", { force = false } = {}) => {
    const clean = normalizeTranscript(text);
    if (!clean) return false;
    const wordCount = clean.split(/\s+/).filter(Boolean).length;
    const meaningfulChars = (clean.match(/[\p{L}\p{N}]/gu) || []).length;
    if (!force && wordCount < VOICE_BATCH_MIN_WORDS && meaningfulChars < VOICE_BATCH_MIN_CHARS) {
      publishDiagnostics({ voiceBatchSkipped: "too-short", voiceBatchSource: source, voiceBatchPreview: clean.slice(0, 80) });
      return false;
    }
    const fingerprint = transcriptFingerprint(clean);
    const queuedDuplicate = voiceBatchQueue.some((batch) => batch.fingerprint === fingerprint);
    if (!fingerprint || fingerprint === voiceBatchLastFingerprint || queuedDuplicate) {
      publishDiagnostics({ voiceBatchSkipped: "duplicate", voiceBatchSource: source });
      return false;
    }
    voiceBatchLastFingerprint = fingerprint;
    voiceBatchQueue.push({ text: clean, source, fingerprint, queuedAt: Date.now() });
    renderState(isCapturing ? "listening" : "auto_submitting", t("voice_batch_queued"));
    publishDiagnostics({ voiceBatchQueued: true, voiceBatchSource: source, voiceBatchQueueLength: voiceBatchQueue.length, voiceBatchPreview: clean.slice(0, 140) });
    void flushVoiceBatchQueue();
    return true;
  };

  const updateListeningStatus = () => {
    if (voiceState !== "listening" || !status) return;
    const level = audioLevelPercent();
    const silenceSeconds = heardVoice ? Math.max(0, Math.ceil((SILENCE_AUTO_SEND_MS - (Date.now() - lastVoiceAt)) / 1000)) : null;
    const pauseHint = heardVoice ? ` · ${silenceSeconds}s` : ` · ${t("voice_waiting_for_voice")}`;
    const batchHint = liveBatchQueuedOrSent() ? ` · ${t("voice_batching")}: ${voiceBatchSubmittedCount}/${voiceBatchQueue.length}` : "";
    const liveMessage = `${t("voice_listening_live")} ${formatDuration((Date.now() - startedAt) / 1000)} · ▂ ${level}%${pauseHint}${batchHint}`;
    status.textContent = liveMessage;
    publishDiagnostics({ audioLevelPercent: level, liveEngine: browserRecognitionAvailable ? "browser-streaming" : "server-audio-stream" });
    if (heardVoice && Date.now() - lastVoiceAt >= SILENCE_AUTO_SEND_MS) {
      void stopAudioCapture({ autoSubmit: true, reason: "silence" });
    }
  };

  const stopActivityMonitor = () => {
    clearTimeout(captureTimeout);
    captureTimeout = null;
    microphoneSource?.disconnect();
    microphoneSource = null;
    pcmProcessor?.disconnect();
    pcmProcessor = null;
    pcmSilence?.disconnect();
    pcmSilence = null;
    if (audioContext) audioContext.close().catch(() => {});
    audioContext = null;
  };

  const releaseRecorder = () => {
    clearInterval(liveTimer);
    liveTimer = null;
    stopActivityMonitor();
    audioStream?.getTracks().forEach((track) => track.stop());
    audioStream = null;
    isCapturing = false;
    publishDiagnostics({ recorderReleased: true });
  };

  const renderProvisionalTranscript = () => {
    const finalText = normalizeTranscript(browserFinalTranscript);
    const interimText = normalizeTranscript(browserInterimTranscript);
    const liveText = normalizeTranscript(`${finalText} ${interimText}`);
    if (!liveText) return;
    livePreviewSeen = true;
    livePreviewText = liveText;
    committedTranscript = finalText || liveText;
    writeTranscriptDraft(liveText);
    publishDiagnostics({
      liveEngine: "browser-streaming",
      liveTranscriptCharacters: liveText.length,
      liveTranscriptPreview: liveText.slice(0, 140)
    });
  };

  const startBrowserRecognition = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const headlessOrAutomation = navigator.webdriver && !window.__synodAllowBrowserRecognition;
    browserRecognitionAvailable = Boolean(Recognition) && !headlessOrAutomation;
    browserFinalTranscript = "";
    browserInterimTranscript = "";
    browserRecognitionConfidence = null;
    browserRecognitionSuppressed = false;
    if (!Recognition || headlessOrAutomation) {
      publishDiagnostics({ liveEngine: "server-audio-stream", liveCaptions: headlessOrAutomation ? "browser-recognition-suppressed-automation" : "browser-recognition-unavailable" });
      return;
    }
    try {
      const spokenLanguage = $("voiceInputLanguage")?.value || "auto";
      browserRecognition = new Recognition();
      browserRecognition.continuous = true;
      browserRecognition.interimResults = true;
      browserRecognition.maxAlternatives = 1;
      browserRecognition.lang = spokenLanguage === "auto" ? (navigator.language || speechLocale(document.documentElement.lang || "en")) : speechLocale(spokenLanguage);
      browserRecognition.onresult = (event) => {
        let finalText = browserFinalTranscript;
        let interimText = "";
        const finalizedThisEvent = [];
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const alternative = result?.[0];
          const transcript = normalizeTranscript(alternative?.transcript || "");
          const confidence = Number(alternative?.confidence);
          if (Number.isFinite(confidence) && confidence > 0) browserRecognitionConfidence = confidence;
          if (!transcript) continue;
          if (result.isFinal && Number.isFinite(confidence) && confidence > 0 && confidence < 0.48) {
            browserRecognitionSuppressed = true;
            publishDiagnostics({ liveCaptions: "suppressed-low-confidence", browserRecognitionConfidence: confidence, suppressedTranscript: transcript.slice(0, 80) });
            continue;
          }
          if (result.isFinal) {
            finalText = normalizeTranscript(`${finalText} ${transcript}`);
            finalizedThisEvent.push(transcript);
          } else if (!browserRecognitionSuppressed) {
            interimText = normalizeTranscript(`${interimText} ${transcript}`);
          }
        }
        browserFinalTranscript = finalText;
        browserInterimTranscript = interimText;
        renderProvisionalTranscript();
        if (finalizedThisEvent.length) queueVoiceBatch(finalizedThisEvent.join(" "), "browser-final");
      };
      browserRecognition.onerror = (event) => {
        publishDiagnostics({ liveCaptions: "browser-recognition-error", recognitionError: event.error || "unknown" });
      };
      browserRecognition.onend = () => {
        browserRecognitionActive = false;
        publishDiagnostics({ browserRecognitionActive });
      };
      browserRecognition.start();
      browserRecognitionActive = true;
      publishDiagnostics({ liveEngine: "browser-streaming", browserRecognitionActive, recognitionLanguage: browserRecognition.lang });
    } catch (error) {
      browserRecognition = null;
      browserRecognitionActive = false;
      publishDiagnostics({ liveCaptions: "browser-recognition-start-failed", recognitionError: error.message });
    }
  };

  const stopBrowserRecognition = () => {
    if (!browserRecognition) return;
    try { browserRecognition.stop(); } catch {}
    browserRecognition = null;
    browserRecognitionActive = false;
    browserInterimTranscript = "";
  };

  const connectVoiceStream = () => new Promise((resolve, reject) => {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/api/v1/voice/stream`);
    let settled = false;
    let openTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch {}
      reject(new Error("Timed out opening the voice stream."));
    }, REQUEST_TIMEOUT_MS);
    streamSocket = socket;
    streamConnected = false;
    streamFinalRequested = false;
    streamSessionId = "";
    serverFinalTranscript = "";
    streamFinalPromise = new Promise((finalResolve, finalReject) => {
      resolveStreamFinal = finalResolve;
      rejectStreamFinal = finalReject;
    });
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        type: "start",
        sampleRate: pcmSampleRate || DEFAULT_AUDIO_SAMPLE_RATE,
        language: $("voiceInputLanguage")?.value || "auto",
        silenceMs: SILENCE_AUTO_SEND_MS
      }));
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.sessionId) streamSessionId = message.sessionId;
      if (message.type === "ready") {
        streamConnected = true;
        clearTimeout(openTimer);
        if (!settled) {
          settled = true;
          resolve(message);
        }
        publishDiagnostics({ streamConnected, streamSessionId, streamSampleRate: message.sampleRate });
      } else if (message.type === "activity") {
        if (typeof message.rms === "number") lastLevel = Math.max(lastLevel, message.rms);
        if (typeof message.peakLevel === "number") peakLevel = Math.max(peakLevel, message.peakLevel);
        if (message.heardVoice) {
          heardVoice = true;
          lastVoiceAt = Date.now() - Math.min(SILENCE_AUTO_SEND_MS, Number(message.silenceMs || 0));
        }
        publishDiagnostics({ streamActivity: message });
      } else if (message.type === "silence") {
        publishDiagnostics({ streamSilence: message });
        if (isCapturing && !isStopping) void stopAudioCapture({ autoSubmit: true, reason: "server-silence" });
      } else if (message.type === "finalizing") {
        renderState("transcribing", t("voice_finalizing"));
        publishDiagnostics({ streamFinalizing: message });
      } else if (message.type === "final") {
        serverFinalTranscript = normalizeTranscript(message.text);
        committedTranscript = serverFinalTranscript;
        finalTranscriptSource = "stream-whisper";
        finalModelName = message.modelName || "";
        finalQuality = message.quality || "";
        liveTranscriptParts = committedTranscript ? [committedTranscript] : [];
        liveSegmentStartSample = pcmSampleCount;
        if (!finalDraftWriteSuppressed) writeTranscriptDraft(committedTranscript);
        publishDiagnostics({
          streamFinal: true,
          finalSource: "stream-whisper",
          finalModelName: message.modelName,
          finalQuality: message.quality,
          transcriptCharacters: committedTranscript.length,
          transcriptPreview: committedTranscript.slice(0, 140)
        });
        resolveStreamFinal?.(message);
      } else if (message.type === "error") {
        const error = Object.assign(new Error(message.error?.message || "Voice stream failed."), { status: message.error?.status || 502 });
        publishDiagnostics({ streamError: error.message, streamErrorStatus: error.status });
        rejectStreamFinal?.(error);
        if (!settled) {
          settled = true;
          clearTimeout(openTimer);
          reject(error);
        }
      }
    });
    socket.addEventListener("close", () => {
      streamConnected = false;
      publishDiagnostics({ streamConnected, streamClosed: true });
      if (!settled) {
        settled = true;
        clearTimeout(openTimer);
        reject(new Error("Voice stream closed before it was ready."));
      } else if (streamFinalRequested && !serverFinalTranscript) {
        rejectStreamFinal?.(new Error("Voice stream closed before final transcript."));
      }
    });
    socket.addEventListener("error", () => {
      const error = new Error("Voice stream connection failed.");
      publishDiagnostics({ streamError: error.message });
      if (!settled) {
        settled = true;
        clearTimeout(openTimer);
        reject(error);
      }
    });
  });

  const sendPcmToStream = (input) => {
    if (!streamSocket || streamSocket.readyState !== WebSocket.OPEN || streamFinalRequested) return;
    try {
      streamSocket.send(float32ToPcm16Buffer(input));
    } catch (error) {
      publishDiagnostics({ streamSendError: error.message });
    }
  };

  const requestStreamFinal = async (reason = "manual") => {
    if (!streamSocket || streamSocket.readyState !== WebSocket.OPEN || !streamFinalPromise) return null;
    streamFinalRequested = true;
    streamSocket.send(JSON.stringify({ type: "stop", reason }));
    const timeout = new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("Voice stream final transcription timed out."), { status: 504 })), STREAM_FINAL_TIMEOUT_MS));
    return Promise.race([streamFinalPromise, timeout]);
  };

  const closeVoiceStream = (cancel = false) => {
    if (!streamSocket) return;
    try {
      if (streamSocket.readyState === WebSocket.OPEN && cancel) streamSocket.send(JSON.stringify({ type: "cancel" }));
      streamSocket.close();
    } catch {}
    streamSocket = null;
    streamConnected = false;
    streamFinalRequested = false;
    resolveStreamFinal = null;
    rejectStreamFinal = null;
    streamFinalPromise = null;
  };

  const transcribeSegment = async ({ final = false } = {}) => {
    if (activeController) return "";
    if (!finalAudioBlob && !pcmSampleCount) {
      publishDiagnostics({ error: "empty-capture" });
      return "";
    }
    // Whisper receives one complete utterance. Short rolling jobs both lose
    // linguistic context and keep consuming CPU after a browser-side abort.
    const chunks = [...pcmChunks];
    const pcmSeconds = captureSeconds();
    const encodedBlob = finalAudioBlob?.size ? finalAudioBlob : null;
    const candidates = [];
    if (chunks.length && pcmSampleRate && pcmSeconds >= MIN_AUDIO_MS / 1000) {
      candidates.push({
        kind: "pcm-wav",
        contentType: "audio/wav",
        body: pcmChunksToWavBlob(chunks, pcmSampleRate),
        seconds: pcmSeconds
      });
    }
    if (encodedBlob) {
      candidates.push({
        kind: "encoded-media",
        contentType: encodedBlob.type || "audio/webm",
        body: encodedBlob,
        seconds: Math.max(pcmSeconds, (Date.now() - startedAt) / 1000)
      });
    }
    if (!candidates.length) {
      publishDiagnostics({ error: "capture-too-short", pcmSeconds, encodedBytes: encodedBlob?.size || 0 });
      renderState("error", t("voice_no_speech"));
      return "";
    }
    const controller = new AbortController();
    activeController = controller;
    const timeout = setTimeout(() => controller.abort("timeout"), final ? FINAL_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    let lastError = null;
    try {
      for (const candidate of candidates) {
        let response;
        let data = {};
        const startedRequestAt = performance.now();
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const spokenLanguage = $("voiceInputLanguage")?.value || "auto";
          publishDiagnostics({
            requestKind: candidate.kind,
            requestAttempt: attempt + 1,
            requestBytes: candidate.body.size || candidate.body.length || 0,
            requestSeconds: Number(candidate.seconds.toFixed(2))
          });
          response = await fetch("/api/v1/voice/transcribe", {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": candidate.contentType, "X-Synod-Language": spokenLanguage, "X-Synod-Quality": final ? "final" : "standard" },
            body: candidate.body
          });
          data = await response.json().catch(() => ({}));
          publishDiagnostics({
            requestKind: candidate.kind,
            requestAttempt: attempt + 1,
            responseStatus: response.status,
            transcriptionMs: Math.round(performance.now() - startedRequestAt)
          });
          if (response.ok || response.status < 500 || attempt === 2) break;
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1) + Math.random() * 120));
        }
        if (!response.ok) {
          lastError = Object.assign(new Error(data?.error?.message || `HTTP ${response.status}`), { status: response.status, requestKind: candidate.kind });
          continue;
        }
        committedTranscript = normalizeTranscript(data.text);
        finalTranscriptSource = final ? "http-final-whisper" : "http-preview";
        finalModelName = data.modelName || "";
        finalQuality = data.quality || "";
        liveTranscriptParts = committedTranscript ? [committedTranscript] : [];
        liveSegmentStartSample = pcmSampleCount;
        publishDiagnostics({
          requestKind: candidate.kind,
          transcriptCharacters: committedTranscript.length,
          transcriptWords: committedTranscript ? committedTranscript.split(/\s+/).length : 0,
          transcriptPreview: committedTranscript.slice(0, 140)
        });
        if (committedTranscript) {
          if (!finalDraftWriteSuppressed) writeTranscriptDraft(committedTranscript);
          return data.text;
        }
        lastError = Object.assign(new Error("Empty transcription response."), { status: 422, requestKind: candidate.kind });
      }
      throw lastError || Object.assign(new Error("Voice transcription failed."), { status: 502 });
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason !== "timeout") return "";
      if (final && committedTranscript && controller.signal.reason === "timeout") {
        publishDiagnostics({ finalFallback: "live-transcript", error: "final-timeout-used-live-preview" });
        return committedTranscript;
      }
      const key = controller.signal.reason === "timeout" ? "voice_timeout" : error.status === 422 ? "voice_no_speech" : "voice_unavailable";
      publishDiagnostics({ error: error.message, errorStatus: error.status, failedRequestKind: error.requestKind });
      renderState("error", t(key));
      return "";
    } finally {
      clearTimeout(timeout);
      if (activeController === controller) activeController = null;
    }
  };

  const queueAutoSubmit = () => {
    clearAutoSubmit();
    autoSubmitQueued = true;
    renderState("auto_submitting", t("voice_auto_sending"));
    publishDiagnostics({ autoSubmitDelayMs: AUTO_SUBMIT_DELAY_MS });
    speakText(t("voice_filler_think"), `voice-filler-${Date.now()}`);
    autoSubmitTimer = setTimeout(() => {
      autoSubmitTimer = null;
      if (voiceState !== "auto_submitting") return;
      if (liveBatchQueuedOrSent()) {
        renderState("ready", t("voice_batches_sent"));
        return;
      }
      const queued = queueVoiceBatch(committedTranscript || txt.value.trim(), "final-whisper", { force: true });
      if (queued) {
        txt.value = originalText;
        renderState("ready", t("voice_batches_sent"));
      } else if (txt.value.trim()) {
        void handleUnifiedSubmit();
      }
    }, AUTO_SUBMIT_DELAY_MS);
  };

  const finishReview = ({ autoSubmit = false } = {}) => {
    if (voiceState === "error") return;
    if (autoSubmit && liveBatchQueuedOrSent()) return renderState("ready", t("voice_batches_sent"));
    if (!committedTranscript) return renderState("error", t("voice_no_speech"));
    if (autoSubmit) return queueAutoSubmit();
    renderState("review");
    txt.focus();
  };

  const stopMediaRecorder = async () => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return null;
    const recorder = mediaRecorder;
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        setTimeout(() => {
          const blob = new Blob(mediaChunks, { type: recorder.mimeType || "audio/webm" });
          resolve(blob.size ? blob : null);
        }, 120);
      };
      recorder.addEventListener("stop", finish, { once: true });
      recorder.addEventListener("error", finish, { once: true });
      try {
        if (recorder.state === "recording" && recorder.requestData) recorder.requestData();
        recorder.stop();
      } catch {
        finish();
      }
    });
  };

  const stopAudioCapture = async ({ autoSubmit = false, reason = "manual" } = {}) => {
    if (!isCapturing || isStopping) return;
    isStopping = true;
    try {
      stopBrowserRecognition();
      if (activeController) {
        activeController.abort("superseded-by-final");
        activeController = null;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      finalAudioBlob = await stopMediaRecorder();
      publishDiagnostics({ stopRequested: true, stopReason: reason, finalEncodedBytes: finalAudioBlob?.size || 0 });
      releaseRecorder();
      renderState("transcribing", autoSubmit ? t("voice_pause_detected") : t("voice_transcribing"));
      const liveBatchesActive = autoSubmit && liveBatchQueuedOrSent();
      finalDraftWriteSuppressed = liveBatchesActive;
      if (liveBatchesActive) {
        const finalizeInBackground = async () => {
          try {
            if (streamConnected || streamFinalPromise) await requestStreamFinal(reason);
          } catch (error) {
            publishDiagnostics({ streamFinalError: error.message, streamFinalErrorStatus: error.status, fallback: "live-batches-already-submitted" });
          } finally {
            closeVoiceStream(false);
          }
        };
        void finalizeInBackground();
        finishReview({ autoSubmit });
        return;
      }
      if (streamConnected || streamFinalPromise) {
        try {
          const finalMessage = await requestStreamFinal(reason);
          if (finalMessage?.text) {
            committedTranscript = normalizeTranscript(finalMessage.text);
            if (!finalDraftWriteSuppressed) writeTranscriptDraft(committedTranscript);
          }
        } catch (error) {
          publishDiagnostics({ streamFinalError: error.message, streamFinalErrorStatus: error.status, fallback: "http-final-pass" });
        }
      }
      if (!committedTranscript) await transcribeSegment({ final: true });
      closeVoiceStream(false);
      finishReview({ autoSubmit });
    } finally {
      isStopping = false;
    }
  };

  const startActivityMonitor = () => {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor || !audioStream || audioContext) return;
    audioContext = new AudioContextCtor();
    pcmSampleRate = audioContext.sampleRate;
    microphoneSource = audioContext.createMediaStreamSource(audioStream);
    pcmProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    pcmSilence = audioContext.createGain();
    pcmSilence.gain.value = 0;
    microphoneSource.connect(pcmProcessor);
    pcmProcessor.connect(pcmSilence);
    pcmSilence.connect(audioContext.destination);
    pcmProcessor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input);
      let sum = 0;
      let peak = 0;
      for (const value of input) {
        const absolute = Math.abs(value);
        sum += value * value;
        if (absolute > peak) peak = absolute;
      }
      lastLevel = Math.sqrt(sum / Math.max(1, input.length));
      peakLevel = Math.max(peakLevel, lastLevel, peak * 0.5);
      if (lastLevel >= VOICE_RMS_THRESHOLD || peak >= VOICE_RMS_THRESHOLD * 4) {
        heardVoice = true;
        lastVoiceAt = Date.now();
      }
      sendPcmToStream(input);
      pcmChunks.push(copy);
      pcmSampleCount += copy.length;
      const maximumSamples = Math.floor((pcmSampleRate || audioContext.sampleRate) * 60);
      while (pcmSampleCount > maximumSamples && pcmChunks.length) {
        const oldest = pcmChunks[0];
        const excess = pcmSampleCount - maximumSamples;
        if (oldest.length <= excess) {
          pcmChunks.shift();
          pcmSampleCount -= oldest.length;
        } else {
          pcmChunks[0] = oldest.slice(excess);
          pcmSampleCount -= excess;
        }
      }
    };
  };

  const startAudioCapture = async () => {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || (!window.MediaRecorder && !AudioContextCtor)) throw new Error("This browser cannot capture microphone audio for local transcription.");
    // Prefer unprocessed mono speech. Browser voice-processing stacks can gate
    // quiet consonants and reduce a sentence to a few surviving syllables.
    // Synod stops output speech before capture, so echo cancellation is not
    // needed here and raw audio gives Whisper substantially better evidence.
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    } });
    pcmChunks = [];
    pcmSampleCount = 0;
    mediaChunks = [];
    finalAudioBlob = null;
    liveTranscriptParts = [];
    liveSegmentStartSample = 0;
    livePreviewSeen = false;
    livePreviewText = "";
    browserFinalTranscript = "";
    browserInterimTranscript = "";
    browserRecognitionConfidence = null;
    browserRecognitionSuppressed = false;
    serverFinalTranscript = "";
    finalTranscriptSource = "";
    finalModelName = "";
    finalQuality = "";
    finalDraftWriteSuppressed = false;
    voiceBatchQueue = [];
    voiceBatchSubmitting = false;
    voiceBatchSubmittedCount = 0;
    voiceBatchConversationId = currentSession?.conversation_id && (isSessionRunning(currentSession.status) || nextMessageMode === "continue") ? currentSession.conversation_id : "";
    voiceBatchFollowUpSessionId = voiceBatchConversationId ? currentSession?.id || "" : "";
    voiceBatchLastFingerprint = "";
    streamSessionId = "";
    streamConnected = false;
    streamFinalRequested = false;
    clearAutoSubmit();
    startedAt = Date.now();
    lastVoiceAt = startedAt;
    heardVoice = false;
    lastLevel = 0;
    peakLevel = 0;
    isCapturing = true;
    startActivityMonitor();
    await audioContext?.resume();
    if (audioContext) {
      try {
        await connectVoiceStream();
      } catch (error) {
        publishDiagnostics({ streamStartError: error.message, fallback: "http-final-pass" });
      }
      startBrowserRecognition();
      await new Promise((resolve) => setTimeout(resolve, START_LEAD_IN_MS));
    }
    if (!audioContext && window.MediaRecorder) {
      const preferredType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
      mediaRecorder = new MediaRecorder(audioStream, preferredType ? { mimeType: preferredType } : undefined);
      mediaRecorder.addEventListener("dataavailable", (event) => { if (event.data?.size) mediaChunks.push(event.data); });
      const recorderStarted = new Promise((resolve, reject) => {
        mediaRecorder.addEventListener("start", resolve, { once: true });
        mediaRecorder.addEventListener("error", (event) => reject(event.error || new Error("Microphone recorder failed to start.")), { once: true });
      });
      mediaRecorder.start(1000);
      await recorderStarted;
      // Capture a short lead-in before the UI invites speech. This closes the
      // race between the visible Listening state and the browser audio encoder.
      await new Promise((resolve) => setTimeout(resolve, START_LEAD_IN_MS));
    } else {
      mediaRecorder = null;
    }
    publishDiagnostics({ captureStarted: true, audioContext: Boolean(audioContext), streamConnected, browserRecognitionAvailable });
    updateListeningStatus();
    liveTimer = setInterval(updateListeningStatus, 500);
    captureTimeout = setTimeout(() => void stopAudioCapture(), MAX_AUDIO_MS);
  };

  const cancelCapture = () => {
    if (!isCapturing && voiceState === "auto_submitting") {
      clearAutoSubmit();
      renderState("review");
      txt.focus();
      return;
    }
    activeController?.abort("cancelled");
    activeController = null;
    stopBrowserRecognition();
    closeVoiceStream(true);
    if (mediaRecorder?.state === "recording") mediaRecorder.stop();
    mediaRecorder = null;
    mediaChunks = [];
    finalAudioBlob = null;
    releaseRecorder();
    pcmChunks = [];
    pcmSampleCount = 0;
    committedTranscript = "";
    liveTranscriptParts = [];
    liveSegmentStartSample = 0;
    livePreviewSeen = false;
    livePreviewText = "";
    browserFinalTranscript = "";
    browserInterimTranscript = "";
    browserRecognitionConfidence = null;
    browserRecognitionSuppressed = false;
    serverFinalTranscript = "";
    streamSessionId = "";
    finalTranscriptSource = "";
    finalModelName = "";
    finalQuality = "";
    finalDraftWriteSuppressed = false;
    voiceBatchQueue = [];
    voiceBatchSubmitting = false;
    voiceBatchSubmittedCount = 0;
    voiceBatchConversationId = "";
    voiceBatchFollowUpSessionId = "";
    voiceBatchLastFingerprint = "";
    txt.value = originalText;
    renderState(readiness?.ready ? "cancelled" : "unavailable");
    setTimeout(() => { if (voiceState === "cancelled") renderState("ready"); }, 1400);
  };

  const probeVoice = async () => {
    renderState("checking", t("voice_greeting"));
    try {
      if (!window.isSecureContext && location.hostname !== "localhost") throw Object.assign(new Error(t("voice_https")), { voiceKey: "voice_https" });
      const voice = await api("/voice/status");
      if (!voice.available) throw new Error(t("voice_unavailable"));
      readiness = { ...voice, ready: true, warming: true };
      renderState("warming", t("voice_warming"));
      // The status check is instant. Exercise the full engine in the background
      // so model warm-up never blocks access to the microphone.
      api("/voice/probe", { method: "POST" }).then((probe) => {
        readiness = { ...probe, ready: true, warming: false };
        if (["checking", "warming", "ready"].includes(voiceState)) renderState("ready");
        if (diagnostics) diagnostics.textContent = JSON.stringify({ secureContext: window.isSecureContext, mediaDevices: Boolean(navigator.mediaDevices), ...readiness }, null, 2);
      }).catch(() => {
        readiness = { ...voice, ready: true, warming: false, probe: "background-failed" };
        if (voiceState === "warming") renderState("ready");
      });
    } catch (error) {
      readiness = null;
      const unreachable = /failed to fetch|networkerror|load failed|temporarily unavailable|synod is temporarily unavailable/i.test(error?.message || "");
      renderState("unavailable", error.voiceKey ? t(error.voiceKey) : unreachable ? t("voice_server_unreachable") : t("voice_unavailable"));
      publishDiagnostics({ readinessError: error?.message || "unknown", serverReachable: !unreachable });
    }
    if (diagnostics) diagnostics.textContent = JSON.stringify({ secureContext: window.isSecureContext, mediaDevices: Boolean(navigator.mediaDevices), ...readiness }, null, 2);
  };

  btn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isCapturing) return void stopAudioCapture();
    if (!readiness?.ready) return void probeVoice();
    originalText = txt.value.trim();
    committedTranscript = "";
    window.speechSynthesis?.cancel();
    renderState("checking", t("voice_checking"));
    try {
      await startAudioCapture();
      renderState("listening");
    } catch (error) {
      const message = error?.name === "NotAllowedError" ? t("voice_permission") : t("voice_unavailable");
      renderState("error", message);
      releaseRecorder();
    }
  });
  cancelBtn?.addEventListener("click", cancelCapture);
  retryBtn?.addEventListener("click", () => void probeVoice());
  diagnosticsBtn?.addEventListener("click", () => diagnostics?.classList.toggle("hidden"));
  document.addEventListener("synod:language-changed", () => renderState(voiceState));
  document.addEventListener("synod:session-complete", () => void flushVoiceBatchQueue());
  document.addEventListener("synod:message-sent", () => {
    if (isCapturing || voiceBatchSubmitting || voiceBatchQueue.length) return;
    clearAutoSubmit();
    pcmChunks = [];
    pcmSampleCount = 0;
    committedTranscript = "";
    liveTranscriptParts = [];
    liveSegmentStartSample = 0;
    livePreviewSeen = false;
    livePreviewText = "";
    browserFinalTranscript = "";
    browserInterimTranscript = "";
    browserRecognitionConfidence = null;
    browserRecognitionSuppressed = false;
    serverFinalTranscript = "";
    streamSessionId = "";
    streamConnected = false;
    streamFinalRequested = false;
    finalTranscriptSource = "";
    finalModelName = "";
    finalQuality = "";
    finalDraftWriteSuppressed = false;
    voiceBatchQueue = [];
    voiceBatchSubmitting = false;
    voiceBatchSubmittedCount = 0;
    voiceBatchConversationId = "";
    voiceBatchFollowUpSessionId = "";
    voiceBatchLastFingerprint = "";
    renderState(readiness?.ready ? "ready" : "unavailable");
  });
  window.addEventListener("beforeunload", cancelCapture);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && ["listening", "transcribing", "review"].includes(voiceState)) cancelCapture(); });
  void probeVoice();
}

function speechLocale(value) {
  return {
    en: "en-US", mr: "mr-IN", hi: "hi-IN", ru: "ru-RU", nl: "nl-NL", ar: "ar-SA", es: "es-ES", de: "de-DE"
  }[String(value || "en").toLowerCase()] || "en-US";
}

function pcmChunksToBase64(chunks) {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(sampleCount * 2);
  let offset = 0;
  for (const chunk of chunks) {
    for (const value of chunk) {
      const sample = Math.max(-1, Math.min(1, value));
      const integer = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      bytes[offset] = integer & 0xff;
      bytes[offset + 1] = (integer >> 8) & 0xff;
      offset += 2;
    }
  }
  let binary = "";
  const blockSize = 0x8000;
  for (let index = 0; index < bytes.length; index += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + blockSize));
  }
  return btoa(binary);
}

function float32ToPcm16Buffer(input) {
  const bytes = new ArrayBuffer(input.length * 2);
  const view = new DataView(bytes);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    const integer = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(index * 2, integer, true);
  }
  return bytes;
}

function pcmChunksToWavBlob(chunks, sampleRate = 48000) {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const pcmBytes = new Uint8Array(sampleCount * 2);
  let pcmOffset = 0;
  for (const chunk of chunks) {
    for (const value of chunk) {
      const sample = Math.max(-1, Math.min(1, value));
      const integer = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      pcmBytes[pcmOffset] = integer & 0xff;
      pcmBytes[pcmOffset + 1] = (integer >> 8) & 0xff;
      pcmOffset += 2;
    }
  }
  const wav = new Uint8Array(44 + pcmBytes.length);
  const view = new DataView(wav.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcmBytes.length, true);
  wav.set(pcmBytes, 44);
  return new Blob([wav], { type: "audio/wav" });
}

function clonePcmRange(chunks, startSample, endSample) {
  const result = [];
  let cursor = 0;
  const start = Math.max(0, startSample);
  const end = Math.max(start, endSample);
  for (const chunk of chunks) {
    const chunkStart = cursor;
    const chunkEnd = cursor + chunk.length;
    if (chunkEnd > start && chunkStart < end) {
      result.push(chunk.slice(Math.max(0, start - chunkStart), Math.min(chunk.length, end - chunkStart)));
    }
    cursor = chunkEnd;
    if (cursor >= end) break;
  }
  return result;
}

function pcmStats(chunks) {
  let sum = 0;
  let peak = 0;
  let sampleCount = 0;
  for (const chunk of chunks) {
    sampleCount += chunk.length;
    for (const value of chunk) {
      const absolute = Math.abs(value);
      sum += value * value;
      if (absolute > peak) peak = absolute;
    }
  }
  return { sampleCount, rms: Math.sqrt(sum / Math.max(1, sampleCount)), peak };
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

// Initialize speech recognition for both inputs
setupSpeechRecognition("mainTopicMicBtn", "mainTopicInput");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((error) => console.warn("Synod offline shell unavailable:", error));
  });
}


// Setup Wizard Controller
let wizardStep = 1;
let selectedBackend = "cloud";

$("openWizardBtn").addEventListener("click", () => {
  wizardStep = 1;
  updateWizardUI();
  
  $("wizSiliconKey").value = $("settingSiliconKey") ? $("settingSiliconKey").value : "";
  $("wizSettingUrl").value = $("settingUrl") ? $("settingUrl").value : "http://localhost:3001/api/v1";
  $("wizSettingKey").value = $("settingKey") ? $("settingKey").value : "";
  
  $("setupWizardModal").classList.remove("hidden");
});

$("closeWizardBtn").addEventListener("click", () => {
  $("setupWizardModal").classList.add("hidden");
});

$("wizCloudBtn").addEventListener("click", () => {
  selectedBackend = "cloud";
  $("wizCloudBtn").classList.add("selected");
  $("wizLocalBtn").classList.remove("selected");
  $("wizCloudBtn").style.borderColor = "var(--accent)";
  $("wizCloudBtn").style.background = "rgba(0, 122, 255, 0.05)";
  $("wizLocalBtn").style.borderColor = "transparent";
  $("wizLocalBtn").style.background = "transparent";
});

$("wizLocalBtn").addEventListener("click", () => {
  selectedBackend = "local";
  $("wizLocalBtn").classList.add("selected");
  $("wizCloudBtn").classList.remove("selected");
  $("wizLocalBtn").style.borderColor = "var(--accent)";
  $("wizLocalBtn").style.background = "rgba(0, 122, 255, 0.05)";
  $("wizCloudBtn").style.borderColor = "transparent";
  $("wizCloudBtn").style.background = "transparent";
});

function updateWizardUI() {
  for (let i = 1; i <= 5; i++) {
    const stepPanel = $(`wizStep${i}`);
    const indicator = $(`indStep${i}`);
    if (stepPanel) stepPanel.classList.add("hidden");
    if (indicator) {
      indicator.classList.remove("active-step");
      indicator.style.fontWeight = "normal";
      indicator.style.color = "var(--muted)";
    }
  }
  
  const currentPanel = $(`wizStep${wizardStep}`);
  const currentIndicator = $(`indStep${wizardStep}`);
  if (currentPanel) currentPanel.classList.remove("hidden");
  if (currentIndicator) {
    currentIndicator.classList.add("active-step");
    currentIndicator.style.fontWeight = "bold";
    currentIndicator.style.color = "var(--accent)";
  }
  
  if (wizardStep === 1) {
    $("wizPrevBtn").style.display = "none";
  } else {
    $("wizPrevBtn").style.display = "inline-flex";
  }
  
  if (wizardStep === 5) {
    $("wizNextBtn").classList.add("hidden");
    $("wizSaveBtn").classList.remove("hidden");
  } else {
    $("wizNextBtn").classList.remove("hidden");
    $("wizSaveBtn").classList.add("hidden");
  }
}

$("wizNextBtn").addEventListener("click", () => {
  if (wizardStep < 5) {
    wizardStep++;
    updateWizardUI();
  }
});

$("wizPrevBtn").addEventListener("click", () => {
  if (wizardStep > 1) {
    wizardStep--;
    updateWizardUI();
  }
});

$("wizSaveBtn").addEventListener("click", async () => {
  if ($("settingUrl")) $("settingUrl").value = $("wizSettingUrl").value;
  if ($("settingKey")) $("settingKey").value = $("wizSettingKey").value;
  if ($("settingSiliconKey")) $("settingSiliconKey").value = $("wizSiliconKey").value;
  
  if ($("settingSiliconModel")) {
    if (selectedBackend === "cloud") {
      $("settingSiliconModel").value = "Qwen/Qwen2.5-72B-Instruct";
    } else {
      $("settingSiliconModel").value = "anythingllm";
    }
  }
  
  const settingsEvent = new Event("submit", { cancelable: true });
  $("settingsForm").dispatchEvent(settingsEvent);

  const manifest = [];
  if ($("wizRoleSyn").checked) {
    manifest.push({"role_type":"SYNTHESIST","display_name":"Lead Synthesist","priority":1,"knowledge_source_type":"HYBRID","workspace_id":"llm-council-lead-synthesist","confidence_weight":1.2});
  }
  if ($("wizRoleExp").checked) {
    manifest.push({"role_type":"DOMAIN_EXPERT","display_name":"Domain Expert","priority":2,"knowledge_source_type":"RAG","workspace_id":"llm-council-domain-expert","confidence_weight":1});
  }
  if ($("wizRoleMkt").checked) {
    manifest.push({"role_type":"MARKETING_SALES","display_name":"Growth & Marketing","priority":3,"knowledge_source_type":"HYBRID","workspace_id":"llm-council-marketing-sales","confidence_weight":1});
  }
  if ($("wizRolePol").checked) {
    manifest.push({"role_type":"ETHICIST","display_name":"Policy Reviewer","priority":4,"knowledge_source_type":"RAG","workspace_id":"llm-council-policy-reviewer","confidence_weight":1});
  }
  if ($("wizRoleRsk").checked) {
    manifest.push({"role_type":"RISK_OFFICER","display_name":"Risk Officer","priority":5,"knowledge_source_type":"RAG","workspace_id":"llm-council-risk-officer","confidence_weight":1});
  }
  
  if ($("manifest")) $("manifest").value = JSON.stringify(manifest, null, 2);
  
  const councilEvent = new Event("submit", { cancelable: true });
  $("councilForm").dispatchEvent(councilEvent);

  showToast("Council configured successfully!", "success");
  $("setupWizardModal").classList.add("hidden");
  await refresh();
});

// Load Settings on initial startup
loadSettings().catch(console.error);

// --- Scout Module: URL Analysis ---
async function scoutAnalyze() {
  const url = $('scoutUrlInput').value.trim();
  if (!url) return;

  const status = $('scoutStatus');
  const btn = $('scoutAnalyzeBtn');
  status.textContent = 'Analyzing…';
  btn.disabled = true;
  btn.style.opacity = '0.5';

  try {
    const res = await fetch('/api/v1/scout/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const responseText = await res.text();
    let data;
    try { data = responseText ? JSON.parse(responseText) : {}; } catch { data = { success: false, error: responseText || `Scout returned HTTP ${res.status}` }; }

    if (!res.ok || !data.success) {
      status.textContent = data.error || 'Analysis failed';
      status.style.color = 'var(--danger, #e74c3c)';
      showToast(data.error || `Scout failed with HTTP ${res.status}`, "error");
      return;
    }

    status.textContent = 'Done! Report ready.';
    status.style.color = 'var(--accent)';
    scoutAutoFeed(data);
  } catch (e) {
    status.textContent = `Scout unavailable: ${e.message}`;
    status.style.color = 'var(--danger, #e74c3c)';
    showToast("Scout could not reach the Synod server. Check that the application is running and try again.", "error");
  } finally {
    btn.disabled = false;
    btn.style.opacity = '';
  }
}

function scoutAutoFeed(data) {
  const meta = data.metadata || {};
  const topic = [
    `Assess the GitHub project ${meta.repo || "repository"} (${meta.url || ""}) and recommend the highest-value path to production readiness.`,
    `Observed stack: ${meta.tech || "unknown"}. Inventory: ${meta.files || 0} files, ${meta.sourceFiles || 0} source files, ${meta.tests || 0} test files, approximately ${meta.loc || "unknown LOC"}.`,
    `Structure: ${(meta.structure || []).join(", ") || "not detected"}.`,
    `Detected gaps: ${(meta.gaps || []).join("; ") || "none from static inspection"}.`,
    `Provide: (1) verified strengths, (2) prioritized gaps, (3) a phased implementation plan with owners and acceptance criteria, (4) security and deployment risks, and (5) the next three actions.`
  ].join('\n').slice(0, 1900);

  const textarea = $('mainTopicInput');
  textarea.value = topic;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();

  const result = $("scoutResult");
  if (result) {
    result.classList.remove("hidden");
    result.innerHTML = `
      <div class="scout-result-head"><span class="status-dot healthy"></span><div><strong>${esc(meta.repo || "Repository analyzed")}</strong><span>${esc(meta.tech || "Technology stack detected")}</span></div></div>
      <div class="scout-stats"><span><b>${esc(meta.files || 0)}</b> files</span><span><b>${esc(meta.tests || 0)}</b> tests</span><span><b>${esc(meta.loc || "—")}</b> LOC</span></div>
      ${(meta.gaps || []).length ? `<div class="scout-gaps"><b>Priority gaps</b>${meta.gaps.slice(0, 4).map((gap) => `<span>${esc(gap)}</span>`).join("")}</div>` : `<p>No baseline delivery gaps detected.</p>`}`;
  }

  // Scroll to topic
  textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Brief toast
  showToast('Scout report loaded. Review and convene when ready.', 'info');

  // Auto-expand textarea
  if (typeof autoResize === 'function') {
    autoResize.call(textarea);
  } else {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }
}

// Bind Scout events (idempotent — runs on DOMContentLoaded or immediately if already loaded)
(function bindScout() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindScout);
    return;
  }
  // Also bind Enter key on the URL input
  const scoutInput = $('scoutUrlInput');
  if (scoutInput) scoutInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); scoutAnalyze(); }
  });
})();

// Export scoutAnalyze for onclick handler (module scope)
window.scoutAnalyze = scoutAnalyze;
