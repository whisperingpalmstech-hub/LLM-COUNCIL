/**
 * AvatarHost - Enterprise AI Avatar Integration
 */
const $ = (id) => document.getElementById(id);

class SpeechEngine {
  constructor() {
    this.synth = window.speechSynthesis;
    this.voice = null;
    this.loadVoices();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = () => this.loadVoices();
    }
  }

  loadVoices() {
    const voices = this.synth.getVoices();
    // Prioritize high quality neural/female voices
    this.voice = voices.find(v => v.name.includes('JennyNeural') || v.name.includes('AvaNeural') || v.name.includes('SoniaNeural') || v.name.includes('Female') || v.name.includes('Samantha') || v.name.includes('Victoria')) || voices[0];
  }

  speak(text, onStart, onEnd) {
    if (!this.synth) return;
    this.synth.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = document.documentElement.lang || "en";
    if (this.voice) utterance.voice = this.voice;
    
    utterance.onstart = () => onStart?.();
    utterance.onend = () => onEnd?.();
    
    this.synth.speak(utterance);
  }

  stop() {
    this.synth.cancel();
  }
}

class AvatarHost {
  constructor() {
    this.state = "immersive";
    this.container = $("avatarStage");
    this.video = $("avatarVideo");
    this.backdrop = $("avatarBackdrop");
    this.overlay = $("avatarPlayOverlay");
    
    this.speech = new SpeechEngine();
    
    this.initialized = false;
    this.bindEvents();
  }

  bindEvents() {
    if (this.overlay) {
      this.overlay.addEventListener("click", () => this.toggleOutput());
    }
  }

  toggleOutput() {
    this.setOutputEnabled(!this.initialized);
  }

  setOutputEnabled(enabled) {
    this.initialized = Boolean(enabled);
    const setting = $("settingEnableVoice");
    if (setting) setting.checked = this.initialized;
    this.overlay?.setAttribute("aria-pressed", String(this.initialized));
    const status = $("outputVoiceStatus");
    if (status) status.textContent = this.initialized ? (window.synodTranslate?.("hear_synod_on") || "Hear Synod on") : (window.synodTranslate?.("hear_synod_off") || "Hear Synod off");
    if (!this.initialized) this.speech.stop();
  }

  setState(newState) {
    this.state = newState;
    // Removed old class switching logic since avatar is permanently immersive
  }

  lipSyncSpeak(text, onComplete) {
    this.speech.speak(
      text,
      () => {
        // onStart
        if (this.container) this.container.classList.add("avatar-speaking");
        if (this.video) this.video.play().catch(e => console.error(e));
      },
      () => {
        // onEnd
        if (this.container) this.container.classList.remove("avatar-speaking");
        if (this.video) this.video.pause();
        onComplete?.();
      }
    );
  }

  initializeWelcome() {
    if (!this.initialized) this.toggleOutput();
  }

  triggerGuide(text) {
    this.lipSyncSpeak(text);
  }

  onSessionStart() {
    // Progress is already visible and announced by the live region. Avoid
    // speaking canned English over a multilingual conversation.
  }

  onRoundComplete(roundNumber) {
    void roundNumber;
  }

  onVerdict(verdictSummary) {
    if (!this.initialized) return;
    this.lipSyncSpeak(verdictSummary, () => {});
  }
}

// Export singleton instance
export const avatarHost = new AvatarHost();
