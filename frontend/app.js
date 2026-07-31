import { translations, setLanguage, t, getCurrentLang } from "./i18n.js";
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

let customAvatarVideoData = null;

async function loadSettings() {
  const settings = await api("/settings");
  $("settingUrl").value = settings.ANYTHING_LLM_URL || "http://localhost:3001/api/v1";
  $("settingKey").value = settings.ANYTHING_LLM_API_KEY || "";
  $("settingKelly").value = settings.KELLY_CIRCUIT_BREAKER_PERCENT || "5";
  $("settingEntropy").value = settings.ENTROPY_THRESHOLD || "30";
  $("settingSiliconKey").value = settings.SILICONFLOW_API_KEY || "";
  $("settingSiliconModel").value = settings.SILICONFLOW_MODEL || "Qwen/Qwen2.5-72B-Instruct";
  $("settingDbType").value = settings.DB_TYPE || "sqlite";
  $("settingDbUrl").value = settings.DB_URL || "";
  
  $("settingEnableVoice").checked = settings.ENABLE_VOICE === "true";
  $("settingTtsEngine").value = settings.TTS_ENGINE || "browser";
  $("settingElevenKey").value = settings.ELEVENLABS_API_KEY || "";
  $("settingElevenVoice").value = settings.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  
  if ($("settingPromptInterviewer")) $("settingPromptInterviewer").value = settings.PROMPT_INTERVIEWER || "";
  if ($("settingPromptDeliberation")) $("settingPromptDeliberation").value = settings.PROMPT_DELIBERATION || "";
  if ($("settingPromptVerdict")) $("settingPromptVerdict").value = settings.PROMPT_VERDICT || "";
  
  if (settings.AVATAR_VIDEO_URL) {
    const video = $("avatarVideo");
    if (video) {
      video.src = settings.AVATAR_VIDEO_URL + "?t=" + Date.now();
      video.load();
    }
  }
}

if ($("settingAvatarVideo")) {
  $("settingAvatarVideo").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
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
      ENABLE_VOICE: $("settingEnableVoice").checked ? "true" : "false",
      TTS_ENGINE: $("settingTtsEngine").value,
      ELEVENLABS_API_KEY: $("settingElevenKey").value,
      ELEVENLABS_VOICE_ID: $("settingElevenVoice").value,
      PROMPT_INTERVIEWER: $("settingPromptInterviewer") ? $("settingPromptInterviewer").value : "",
      PROMPT_DELIBERATION: $("settingPromptDeliberation") ? $("settingPromptDeliberation").value : "",
      PROMPT_VERDICT: $("settingPromptVerdict") ? $("settingPromptVerdict").value : "",
      AVATAR_VIDEO_DATA: customAvatarVideoData || undefined
    })
  });
  
  customAvatarVideoData = null;
  if ($("settingAvatarVideo")) $("settingAvatarVideo").value = "";
  await loadSettings();
  showToast("Settings saved successfully!", "success");
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
  const endpoint = isSuperbrain ? "/pipelines" : "/sessions";
  
  const payload = {
    topic: $("topic").value,
    mode: $("mode").value,
    maxRounds: Number($("rounds").value),
    councilId: $("councilSelect").value || undefined,
    compactInternalCommunication: $("compact").checked,
    allowWebSearch: $("web").checked,
    allowRag: $("rag").checked,
    autoStart: !isSuperbrain
  };
  
  if (attachedFile) {
    payload.fileName = attachedFile.fileName;
    payload.fileType = attachedFile.fileType;
    payload.fileData = attachedFile.fileData;
    attachedFile = null; // Reset after reading
  }
  
  const session = await api(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  selectSession(session.id);
});


$("interviewForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("interviewInput");
  const msg = input.value;
  if (!msg || !currentSessionId) return;
  
  const chat = $("interviewChat");
  chat.innerHTML += `<div style="padding: 8px; border-radius: 4px; background: rgba(37,99,235,0.2); text-align: right;"><strong>You:</strong> ${esc(msg)}</div>`;
  input.value = "";
  
  await api(`/sessions/${currentSessionId}/interview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: msg })
  });
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
  $("transcript").href = `/api/v1/sessions/${id}/transcript`;
  $("transcript").classList.remove("disabled");
  
  if ($("chatFeed")) $("chatFeed").classList.remove("hidden");
  if ($("welcomer")) $("welcomer").classList.add("hidden");

  
  // Show mobile portal link / QR code
  try {
    const ipRes = await api("/mobile/ip");
    const portalUrl = `http://${ipRes.ip}:3000/mobile.html?sessionId=${id}`;
    $("mobileQr").src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(portalUrl)}`;
    $("mobileLink").href = portalUrl;
    $("mobileBridgeCard").classList.remove("hidden");
  } catch (err) {
    console.error("Failed to generate QR code", err);
    $("mobileBridgeCard").classList.add("hidden");
  }

  if (source) source.close();
  source = new EventSource(`/api/v1/sessions/${id}/events`);
  ["ROLE_ACTIVATED", "ROLE_MESSAGE", "ROUND_COMPLETE", "CONSENSUS_UPDATE", "SESSION_COMPLETE", "SESSION_ERROR", "SESSION_STATE_CHANGED", "INTERVIEW_QUESTION", "PIPELINE_STAGE_COMPLETE", "EXECUTION_HANDOFF"].forEach((event) => {
    source.addEventListener(event, async (e) => {
      const data = JSON.parse(e.data);
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
      } else if (data.eventType === "SESSION_COMPLETE" || (data.eventType === "SESSION_STATE_CHANGED" && data.status === "COMPLETED")) {
        try {
          const sessionData = await api(`/sessions/${id}`);
          if (sessionData.session.verdict) {
            const parsedVerdict = JSON.parse(sessionData.session.verdict);
            if (parsedVerdict && parsedVerdict.summary) {
              playTTS(parsedVerdict.summary);
            }
          }
        } catch (err) {
          console.error("Failed to read verdict for TTS", err);
        }
      }
      refresh();
    });
  });
  updateAvatarLayout();
  await refresh();
}

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
  if (!window.speechSynthesis || lastSpokenMessageId === messageId) return;
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
  utterance.lang = document.getElementById("langToggle")?.value || "en";
  
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
  $("status").innerText = session.status;
  
  updateAvatarLayout();
  
  // Trigger speech synthesis depending on state
  if (session.status === "INTERVIEW") {
    const turns = interviewsData.interviews || [];
    if (turns.length > 0) {
      const lastTurn = turns[turns.length - 1];
      if (lastTurn.llm_response) speakText(lastTurn.llm_response, lastTurn.id);
    }
  } else if (session.status === "COMPLETED" && session.verdict && session.verdict.summary) {
    speakText(session.verdict.summary, session.id + "_verdict");
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
  $("consensus").innerText = typeof session.consensus === "number" ? session.consensus.toFixed(3) : "-";
  $("internal").innerText = session.compact_internal ? "Compact" : "Verbose";

  if (simpleModeActive) {
    let combinedHtml = "";
    
    // 1. Render all clarifications/interview turns
    const interviewTurns = interviewsData.interviews || [];
    for (const turn of interviewTurns) {
      combinedHtml += `
        <div style="display: flex; justify-content: flex-end; margin-bottom: 16px;">
          <div style="background: var(--accent); color: white; padding: 12px 18px; border-radius: 18px 18px 4px 18px; max-width: 70%; box-shadow: var(--shadow-sm);">
            <p style="margin: 0; font-size: 15px;">${esc(turn.user_message)}</p>
          </div>
        </div>
        <div style="display: flex; justify-content: flex-start; margin-bottom: 16px;">
          <div style="background: rgba(255,255,255,0.75); color: var(--text); padding: 16px 20px; border-radius: 18px 18px 18px 4px; max-width: 75%; border: 1px solid var(--border); box-shadow: var(--shadow-sm);">
            <div style="font-size: 12px; font-weight: bold; color: var(--accent); margin-bottom: 6px; display: flex; align-items: center; gap: 6px;"><i data-lucide="help-circle" style="width:14px;height:14px;"></i> Lead Synthesist (Interviewer)</div>
            <p style="margin: 0; font-size: 15px;">${esc(turn.llm_response || "Thinking of target outcome...")}</p>
          </div>
        </div>
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
      const displayName = role.display_name || (message.model_name === "obsidian-memory" ? "Obsidian Memory Architect" : (message.model_name === "mobile-upload" ? "Mobile Upload Bridge" : (message.model_name === "file-attachment" ? "File Attachment" : "System")));
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
        <div style="display: flex; justify-content: flex-start; margin-bottom: 16px;">
          <div style="background: rgba(255,255,255,0.75); color: var(--text); padding: 16px 20px; border-radius: 18px 18px 18px 4px; max-width: 75%; border: 1px solid var(--border); box-shadow: var(--shadow-sm);">
            <div style="font-size: 11px; font-weight: bold; color: var(--accent); margin-bottom: 6px; display: flex; align-items: center; gap: 6px;"><i data-lucide="${icon}" style="width:14px;height:14px;"></i> ${esc(displayName)} <span style="color:var(--muted);font-weight:normal;">(${esc(message.model_name)})</span></div>
            <p style="margin: 0; font-size: 15px;">${esc(payload.shortSummary || payload.summary || message.content)}</p>
            ${attachmentHtml}
            ${payload.keyClaims?.length ? `<div style="font-size: 13px; margin-top: 8px; color: var(--muted); border-top: 1px solid var(--border); padding-top: 8px;"><b>Key Claims:</b> <ul style="margin: 4px 0 0 0; padding-left: 16px;">${payload.keyClaims.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>` : ""}
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
      const displayName = role.display_name || (message.model_name === "obsidian-memory" ? "Obsidian Memory Architect" : (message.model_name === "mobile-upload" ? "Mobile Upload Bridge" : (message.model_name === "file-attachment" ? "File Attachment" : "System")));
      const icon = message.role_id ? "user" : (message.model_name === "obsidian-memory" ? "database" : (message.model_name === "mobile-upload" ? "smartphone" : "file-text"));

      let contentHtml = `<div class="summary">${esc(payload.shortSummary || payload.summary || message.content)}</div>`;
      
      if (payload.fileUrl) {
        if (payload.fileType?.startsWith("image/")) {
          contentHtml += `<div style="margin-top: 12px;"><img src="${payload.fileUrl}" style="max-width: 100%; max-height: 250px; border-radius: 8px; border: 1px solid var(--border);" /></div>`;
        } else if (payload.fileType?.startsWith("audio/")) {
          contentHtml += `<div style="margin-top: 12px;"><audio src="${payload.fileUrl}" controls style="width: 100%;"></audio></div>`;
        } else {
          contentHtml += `<div style="margin-top: 12px;"><a href="${payload.fileUrl}" target="_blank" class="button" style="display: inline-flex; align-items: center; gap: 6px; text-decoration: none;"><i data-lucide="download" style="width:16px;height:16px;"></i> Download File</a></div>`;
        }
      }

      if (payload.keyClaims?.length) contentHtml += `<div class="message-section"><h4>${t("key_claims")}</h4><ul>${payload.keyClaims.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>`;
      if (payload.knowledgeGaps?.length) contentHtml += `<div class="message-section"><h4>${t("knowledge_gaps")}</h4><ul>${payload.knowledgeGaps.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>`;
      if (payload.agreements?.length) contentHtml += `<div class="message-section"><h4>${t("agreements")}</h4><ul>${payload.agreements.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>`;
      if (payload.disagreements?.length) contentHtml += `<div class="message-section"><h4>${t("disagreements")}</h4><ul>${payload.disagreements.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>`;

      return `
        <div class="message-card">
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


  const verdictContainer = $("verdict");
  if (session.verdict) {
    if (window.lastAnnouncedVerdict !== session.id) {
      window.lastAnnouncedVerdict = session.id;
      avatarHost.onVerdict(session.verdict.summary);
    }
    
    let executionHtml = "";
    if (session.execution_payload) {
      try {
        const exec = JSON.parse(session.execution_payload);
        const format = exec.format || "";
        const raw = exec.rawPayload || "";
        const renderType = exec.render_type || (session.topic.toLowerCase().includes("project") || session.topic.toLowerCase().includes("plan") || session.topic.toLowerCase().includes("deploy") ? "kanban" : "json");
        
        if (renderType === "kanban" || format.includes("KANBAN") || raw.includes("[TODO]")) {
          const tasks = parseTasksFromPayload(raw);
          executionHtml = `
            <div style="margin-top: 20px; background: rgba(255,255,255,0.05); padding: 16px; border-radius: 16px; border: 1px solid var(--border);">
              <h4 style="margin: 0; display: flex; align-items: center; gap: 8px;"><i data-lucide="kanban"></i> Dynamic Execution Kanban Board</h4>
              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 12px;">
                <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px;">
                  <h5 style="margin: 0 0 8px 0; color: #ff9500;">Todo</h5>
                  <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${tasks.todo.map(t => `<div style="background: rgba(255,255,255,0.05); padding: 8px; border-radius: 6px; font-size: 12px;">${esc(t)}</div>`).join("") || '<span class="muted" style="font-size:11px;">None</span>'}
                  </div>
                </div>
                <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px;">
                  <h5 style="margin: 0 0 8px 0; color: #007aff;">In Progress</h5>
                  <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${tasks.inProgress.map(t => `<div style="background: rgba(255,255,255,0.05); padding: 8px; border-radius: 6px; font-size: 12px;">${esc(t)}</div>`).join("") || '<span class="muted" style="font-size:11px;">None</span>'}
                  </div>
                </div>
                <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px;">
                  <h5 style="margin: 0 0 8px 0; color: #10b981;">Done</h5>
                  <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${tasks.done.map(t => `<div style="background: rgba(255,255,255,0.05); padding: 8px; border-radius: 6px; font-size: 12px;">${esc(t)}</div>`).join("") || '<span class="muted" style="font-size:11px;">None</span>'}
                  </div>
                </div>
              </div>
            </div>
          `;
        } else {
          executionHtml = `
            <div style="margin-top: 20px; background: rgba(255,255,255,0.05); padding: 16px; border-radius: 16px; border: 1px solid var(--border);">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <h4 style="margin: 0; display: flex; align-items: center; gap: 8px;"><i data-lucide="terminal"></i> Agentic Orchestration Report</h4>
                <button class="button" onclick="const a = document.createElement('a'); a.href = 'data:text/json;charset=utf-8,' + encodeURIComponent('${esc(JSON.stringify(exec, null, 2))}'); a.download = 'agentic-report.json'; a.click();" style="padding: 6px 12px; font-size: 12px; border-radius: 8px; border: 1px solid var(--accent); color: var(--accent); background: transparent;"><i data-lucide="download" style="width: 14px; height: 14px;"></i> Download JSON</button>
              </div>
              <pre style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; font-size: 11px; overflow-x: auto; margin: 12px 0 0 0; color: #10b981;"><code>${esc(JSON.stringify(exec, null, 2))}</code></pre>
            </div>
          `;
        }
      } catch (err) {
        console.error("Failed to parse execution payload", err);
      }
    }

    verdictContainer.innerHTML = `
      <div style="background: var(--blue-light); padding: 24px; border-radius: 12px; border: 1px solid var(--primary); margin-bottom: 24px;">
        <h3 style="color: var(--primary); margin-top: 0; display: flex; align-items: center; gap: 8px;"><i data-lucide="award"></i> ${t("final_verdict")}</h3>
        <b style="font-size: 16px; display: block; margin-bottom: 12px;">${esc(session.verdict.summary)}</b>
        <p style="margin: 0; line-height: 1.6;">${esc(session.verdict.majority)}</p>
        ${executionHtml}
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
  const councilOpts = `<option value="">Dynamic Council</option>` + councils.map((council) => `<option value="${council.id}">${esc(council.name)}</option>`).join("");
  $("councilSelect").innerHTML = councilOpts;
  if ($("mainCouncilSelect")) $("mainCouncilSelect").innerHTML = councilOpts;

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
    if (tabId === "settings") loadSettings();
  });
});

function parseTasksFromPayload(raw) {
  const todo = [];
  const inProgress = [];
  const done = [];
  
  const lines = raw.split("\n");
  for (const line of lines) {
    const cleaned = line.replace(/^[-*+\s\d.]+|\[[ xX/]*\]/g, "").trim();
    if (!cleaned) continue;
    
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
  
  if (todo.length === 0 && inProgress.length === 0 && done.length === 0) {
    todo.push(raw.slice(0, 100) + "...");
  }
  
  return { todo, inProgress, done };
}

// Simple Chat Mode Toggle
let simpleModeActive = false;

$("simpleModeToggle").addEventListener("click", () => {
  simpleModeActive = !simpleModeActive;
  if (simpleModeActive) {
    document.body.classList.add("simple-mode");
    $("simpleModeToggle").innerHTML = '<i data-lucide="toggle-right"></i> Simple Mode';
  } else {
    document.body.classList.remove("simple-mode");
    $("simpleModeToggle").innerHTML = '<i data-lucide="toggle-left"></i> Simple Mode';
  }
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
      showToast(`Attached file: ${file.name}`, "success");
      btn.style.color = "#34c759";
      btn.style.borderColor = "#34c759";
    };
    reader.readAsDataURL(file);
  });
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
        if ($("mainTopicFileBtn")) { $("mainTopicFileBtn").style.color = ""; $("mainTopicFileBtn").style.borderColor = ""; }
      }
      await api(`/sessions/${currentSessionId}/interview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      await refresh();
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      $("loader").classList.add("hidden");
    }
  } else if (!currentSessionId) {
    // Start new session
    $("topic").value = input;
    $("mode").value = $("mainMode")?.value || "standard";
    $("rounds").value = $("mainRounds")?.value || "4";
    $("councilSelect").value = $("mainCouncilSelect")?.value || "";
    if ($("superbrain")) $("superbrain").checked = $("mainSuperbrain")?.checked || false;
    if ($("compact")) $("compact").checked = $("mainCompact")?.checked || true;
    if ($("web")) $("web").checked = $("mainWeb")?.checked || true;
    if ($("rag")) $("rag").checked = $("mainRag")?.checked || true;
    
    $("chatFeed").classList.remove("hidden");
    $("welcomer").classList.add("hidden");

    const submitEvent = new Event("submit", { cancelable: true });
    $("sessionForm").dispatchEvent(submitEvent);
    $("mainTopicInput").value = "";
  }
}

$("mainConveneBtn").addEventListener("click", handleUnifiedSubmit);
$("mainTopicInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleUnifiedSubmit();
  }
});

// Speech Recognition Helper for Voice Input
function setupSpeechRecognition(buttonId, textareaId) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    if ($(buttonId)) $(buttonId).style.display = "none";
    return;
  }
  
  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.lang = document.getElementById("langToggle")?.value || "en";
  recognition.interimResults = false;
  
  let isRecording = false;
  
  recognition.onstart = () => {
    isRecording = true;
    $(buttonId).innerHTML = '<i data-lucide="mic-off" style="color: #ff3b30; width: 20px; height: 20px; animation: pulse 1.5s infinite;"></i>';
    if (window.lucide) window.lucide.createIcons();
    showToast("Listening...", "success");
  };
  
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    $(textareaId).value = ($(textareaId).value + " " + transcript).trim();
  };
  
  recognition.onerror = (event) => {
    console.error("Speech recognition error", event);
    showToast("Voice input failed or timed out", "error");
    recognition.stop();
  };
  
  recognition.onend = () => {
    isRecording = false;
    $(buttonId).innerHTML = '<i data-lucide="mic" style="width: 20px; height: 20px;"></i>';
    if (window.lucide) window.lucide.createIcons();
  };
  
  const btn = $(buttonId);
  const txt = $(textareaId);
  if (!btn || !txt) return; // Prevent crashes if UI elements are missing
  
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isRecording) {
      recognition.stop();
    } else {
      recognition.start();
    }
  });
}

// Initialize speech recognition for both inputs
setupSpeechRecognition("mainTopicMicBtn", "mainTopicInput");


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
  $("wizCloudBtn").style.borderColor = "var(--accent)";
  $("wizCloudBtn").style.background = "rgba(0, 122, 255, 0.05)";
  $("wizLocalBtn").style.borderColor = "transparent";
  $("wizLocalBtn").style.background = "transparent";
});

$("wizLocalBtn").addEventListener("click", () => {
  selectedBackend = "local";
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
      indicator.style.fontWeight = "normal";
      indicator.style.color = "var(--muted)";
    }
  }
  
  const currentPanel = $(`wizStep${wizardStep}`);
  const currentIndicator = $(`indStep${wizardStep}`);
  if (currentPanel) currentPanel.classList.remove("hidden");
  if (currentIndicator) {
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

