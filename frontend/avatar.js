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
      this.overlay.addEventListener("click", () => this.initializeWelcome());
    }
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
    if (this.initialized) return;
    this.initialized = true;
    if (this.overlay) this.overlay.classList.add("hidden");
    
    this.lipSyncSpeak(
      "Hello and welcome to the Synod Superbrain. Input your idea or question below, and our multi-LLM council will orchestrate a specialized execution plan for you.",
      () => {}
    );
  }

  triggerGuide(text) {
    this.lipSyncSpeak(text);
  }

  onSessionStart() {
    if (!this.initialized) return;
    this.lipSyncSpeak("Excellent. The council is convening. I will orchestrate the debate and generate the agentic payload once consensus is reached.", () => {
    });
  }

  onRoundComplete(roundNumber) {
    if (!this.initialized) return;
    const phrases = [
      `Round ${roundNumber} completed.`,
      `Proceeding from round ${roundNumber}.`,
      `Analysis for round ${roundNumber} is finished.`
    ];
    this.triggerGuide(phrases[Math.floor(Math.random() * phrases.length)]);
  }

  onVerdict(verdictSummary) {
    if (!this.initialized) return;
    this.lipSyncSpeak(
      "The debate has concluded. Here is your final orchestration payload. " + verdictSummary,
      () => {}
    );
  }
}

// Export singleton instance
export const avatarHost = new AvatarHost();
