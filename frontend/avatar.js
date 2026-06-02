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
    this.state = "hidden";
    this.container = $("avatarContainer");
    this.video = $("avatarVideo");
    this.backdrop = $("avatarBackdrop");
    this.overlay = $("avatarPlayOverlay");
    
    this.speech = new SpeechEngine();
    
    this.initialized = false;
    this.bindEvents();
  }

  bindEvents() {
    this.overlay.addEventListener("click", () => this.initializeWelcome());
    
    // Configuration Contextual Guide
    const topicInput = $("topic");
    const roundsSelect = $("rounds");
    
    let typedTopic = false;
    topicInput?.addEventListener("input", () => {
      if (!this.initialized || typedTopic || this.state !== "config") return;
      typedTopic = true;
      this.triggerGuide("Great choice. Now configure the debate settings.");
    });

    roundsSelect?.addEventListener("change", () => {
      if (!this.initialized || this.state !== "config") return;
      this.triggerGuide("Rounds configured. Your setup is complete. Click Convene Synod whenever you are ready.");
    });
  }

  setState(newState) {
    this.container.classList.remove(`state-${this.state}`);
    this.state = newState;
    this.container.classList.add(`state-${this.state}`);
    
    if (newState === "verdict") {
      this.backdrop.classList.add("active");
    } else {
      this.backdrop.classList.remove("active");
    }
  }

  lipSyncSpeak(text, onComplete) {
    this.speech.speak(
      text,
      () => {
        // onStart
        this.container.classList.add("avatar-speaking");
        this.video.play().catch(e => console.error(e));
      },
      () => {
        // onEnd
        this.container.classList.remove("avatar-speaking");
        this.video.pause();
        onComplete?.();
      }
    );
  }

  initializeWelcome() {
    if (this.initialized) return;
    this.initialized = true;
    this.overlay.classList.add("hidden");
    
    this.setState("welcome");
    
    this.lipSyncSpeak(
      "Hello and welcome to Debate Arena. I am your AI debate facilitator. Please enter your topic, configure your debate settings, select the number of rounds, and click Start Debate when you are ready. I will guide you throughout the process and present the final verdict once the discussion is complete.",
      () => {
        this.setState("config");
      }
    );
  }

  triggerGuide(text) {
    this.lipSyncSpeak(text);
  }

  onSessionStart() {
    if (!this.initialized) return;
    this.setState("welcome"); // Temporarily enlarge to speak
    this.lipSyncSpeak("Excellent. The debate is now beginning. I will monitor the discussion and return with the final verdict once all rounds are completed.", () => {
      this.setState("running");
    });
  }

  onRoundComplete(roundNumber) {
    if (!this.initialized || this.state !== "running") return;
    const phrases = [
      `Round ${roundNumber} completed.`,
      `Proceeding from round ${roundNumber}.`,
      `Analysis for round ${roundNumber} is finished.`
    ];
    this.triggerGuide(phrases[Math.floor(Math.random() * phrases.length)]);
  }

  onVerdict(verdictSummary) {
    if (!this.initialized) return;
    this.setState("verdict");
    this.lipSyncSpeak(
      "The debate has concluded. Based on the discussion, evidence, reasoning, and evaluation criteria, here is the final verdict. " + verdictSummary,
      () => {
        // Optionally close after a delay, or stay open until clicked
        setTimeout(() => {
          this.setState("running");
          this.backdrop.classList.remove("active");
        }, 3000);
      }
    );
  }
}

// Export singleton instance
export const avatarHost = new AvatarHost();
