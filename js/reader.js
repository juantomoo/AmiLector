/**
 * reader.js — TTS Engine with Chrome Keepalive Fix
 * Manages speech synthesis playback, voice selection, and word-level highlighting.
 * Plays text chunk-by-chunk to avoid Chrome's silent-stop bug.
 */

/**
 * Async voice loader — handles the asynchronous nature of Web Speech API voice loading.
 * In Chrome, Google voices arrive after a short delay via onvoiceschanged.
 * @returns {Promise<SpeechSynthesisVoice[]>}
 */
export function loadVoices() {
  return new Promise((resolve) => {
    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices);
      return;
    }

    // Chrome loads voices asynchronously
    let resolved = false;
    speechSynthesis.onvoiceschanged = () => {
      if (!resolved) {
        resolved = true;
        resolve(speechSynthesis.getVoices());
      }
    };

    // Fallback timeout — some browsers never fire onvoiceschanged
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(speechSynthesis.getVoices());
      }
    }, 2000);
  });
}

/**
 * Rank voices by quality tier
 * Google ★★★ > Microsoft ★★ > Other named ★ > Default
 * @param {SpeechSynthesisVoice[]} voices
 * @returns {SpeechSynthesisVoice[]}
 */
export function rankVoices(voices) {
  return [...voices].sort((a, b) => getVoicePriority(a) - getVoicePriority(b));
}

function getVoicePriority(voice) {
  const name = voice.name.toLowerCase();
  if (name.includes('google')) return 1;
  if (name.includes('microsoft') || name.includes('edge')) return 2;
  if (name.includes('apple') || name.includes('samantha') || name.includes('alex')) return 3;
  return 4;
}

/**
 * Get quality tier label for UI display
 * @param {SpeechSynthesisVoice} voice
 * @returns {string}
 */
export function getVoiceQuality(voice) {
  const name = voice.name.toLowerCase();
  if (name.includes('google')) return '★★★';
  if (name.includes('microsoft') || name.includes('edge')) return '★★';
  return '★';
}

/**
 * Voice preference map per language code (ISO 639-1)
 */
const VOICE_PREFERENCES = {
  'es': [
    'Google español', 'Google Spanish', 'Google US Spanish', 'Google español de España',
    'Google español de Estados Unidos', 'Google español de México', 'Google español de Latinoamérica',
    'Microsoft Sabina', 'Microsoft Tomas', 'Microsoft Helena', 'Microsoft Elvira', 'Microsoft Laura',
    'Microsoft Pablo', 'Microsoft Jorge', 'Microsoft Raul', 'Microsoft Alvaro', 'Microsoft Maria',
    'Jorge', 'Monica', 'Conchita', 'Lucia', 'Enrique', 'Laura', 'Pablo', 'Helena', 'Dalia', 'Federico',
    'Paulina', 'Siri', 'Alba', 'Paloma', 'Isabella', 'Teresa'
  ],
  'en': ['Google US English', 'Google UK English Female', 'Google UK English Male', 'Microsoft Zira', 'Microsoft David'],
  'fr': ['Google français', 'Google French', 'Microsoft Hortense', 'Microsoft Paul'],
  'de': ['Google Deutsch', 'Google German', 'Microsoft Hedda', 'Microsoft Stefan'],
  'pt': ['Google português do Brasil', 'Google português', 'Microsoft Helia', 'Microsoft Daniel'],
  'it': ['Google italiano', 'Google Italian', 'Microsoft Elsa', 'Microsoft Cosimo'],
  'ja': ['Google 日本語', 'Google Japanese', 'Microsoft Haruka', 'Microsoft Ichiro'],
  'zh': ['Google 普通话', 'Google 中文', 'Microsoft Huihui', 'Microsoft Kangkang'],
  'ko': ['Google 한국의', 'Google Korean', 'Microsoft Heami'],
  'ru': ['Google русский', 'Google Russian', 'Microsoft Irina', 'Microsoft Pavel'],
  'nl': ['Google Nederlands', 'Google Dutch', 'Microsoft Frank'],
  'pl': ['Google polski', 'Google Polish', 'Microsoft Paulina', 'Microsoft Adam'],
  'ar': ['Google العربية', 'Google Arabic'],
  'hi': ['Google हिन्दी', 'Google Hindi'],
  'tr': ['Google Türkçe', 'Google Turkish'],
  'sv': ['Google svenska', 'Google Swedish'],
  'ca': ['Google català', 'Google Catalan'],
};

/**
 * Find the best voice for a given language code
 * @param {SpeechSynthesisVoice[]} voices
 * @param {string} langCode - ISO 639-1 (e.g., 'es', 'en')
 * @returns {SpeechSynthesisVoice|null}
 */
export function getBestVoiceForLanguage(voices, langCode) {
  const prefs = VOICE_PREFERENCES[langCode] || [];

  // First: try exact preference matches
  for (const pref of prefs) {
    const match = voices.find(v => v.name.includes(pref));
    if (match) return match;
  }

  // Second: any Google voice for this language
  const googleMatch = voices.find(v =>
    v.lang.startsWith(langCode) && v.name.toLowerCase().includes('google')
  );
  if (googleMatch) return googleMatch;

  // Third: any voice matching the language
  const langMatch = voices.find(v => v.lang.startsWith(langCode));
  if (langMatch) return langMatch;

  // Absolute fallback: first available voice
  return voices[0] || null;
}

/**
 * Group voices by language for the selector dropdown
 * @param {SpeechSynthesisVoice[]} voices
 * @returns {Map<string, SpeechSynthesisVoice[]>}
 */
export function groupVoicesByLanguage(voices) {
  const groups = new Map();

  for (const voice of voices) {
    const lang = voice.lang.split('-')[0]; // 'en-US' → 'en'
    if (!groups.has(lang)) {
      groups.set(lang, []);
    }
    groups.get(lang).push(voice);
  }

  // Sort voices within each group by quality
  for (const [lang, voiceList] of groups) {
    groups.set(lang, rankVoices(voiceList));
  }

  return groups;
}


// ─── TTS Engine Class ──────────────────────────────────────────

export class TTSEngine {
  constructor() {
    this.chunks = [];
    this.currentChunk = 0;
    this.utterance = null;
    this.voice = null;
    this.language = 'es';
    this.rate = 1.0;
    this.pitch = 1.0;
    this.isPlaying = false;
    this.isPaused = false;
    this._keepAliveInterval = null;

    // Event callbacks
    this.onChunkStart = null;    // (chunkIndex) => {}
    this.onChunkEnd = null;      // (chunkIndex) => {}
    this.onWordBoundary = null;  // (chunkIndex, charIndex, charLength) => {}
    this.onFinish = null;        // () => {}
    this.onStateChange = null;   // (state: 'playing'|'paused'|'stopped') => {}
    this.onError = null;         // (error) => {}
  }

  /**
   * Start speaking from a specific chunk
   * @param {string[]} chunks - Array of text chunks
   * @param {number} startFrom - Chunk index to start from
   */
  async speak(chunks, startFrom = 0) {
    // Cancel any existing speech
    this._stopKeepAlive();
    speechSynthesis.cancel();

    this.chunks = chunks;
    this.currentChunk = Math.max(0, Math.min(startFrom, chunks.length - 1));
    this.isPlaying = true;
    this.isPaused = false;

    this._emitStateChange('playing');
    await this._speakCurrentChunk();
  }

  /**
   * Internal: speak the current chunk and chain to the next
   */
  async _speakCurrentChunk() {
    if (!this.isPlaying || this.currentChunk >= this.chunks.length) {
      this._finish();
      return;
    }

    const text = this.chunks[this.currentChunk];
    if (!text || text.trim().length === 0) {
      this.currentChunk++;
      this._speakCurrentChunk();
      return;
    }

    this.utterance = new SpeechSynthesisUtterance(text);

    if (this.voice) this.utterance.voice = this.voice;
    this.utterance.rate = this.rate;
    this.utterance.pitch = this.pitch;
    this.utterance.lang = this.language;

    // Word boundary for real-time word highlighting
    this.utterance.onboundary = (event) => {
      if (event.name === 'word' && this.onWordBoundary) {
        this.onWordBoundary(this.currentChunk, event.charIndex, event.charLength || 0);
      }
    };

    // When chunk finishes, move to next
    this.utterance.onend = () => {
      if (this.onChunkEnd) this.onChunkEnd(this.currentChunk);
      this.currentChunk++;
      if (this.isPlaying) {
        this._speakCurrentChunk();
      }
    };

    // Error handling — 'interrupted' is expected when manually stopping
    this.utterance.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      console.warn('TTS error:', e.error);
      if (this.onError) this.onError(e.error);
      // Try to continue with next chunk
      this.currentChunk++;
      if (this.isPlaying) {
        setTimeout(() => this._speakCurrentChunk(), 100);
      }
    };

    // Emit chunk start
    if (this.onChunkStart) this.onChunkStart(this.currentChunk);

    // Start keepalive to prevent Chrome's silent-stop bug
    this._startKeepAlive();

    speechSynthesis.speak(this.utterance);
  }

  /**
   * Chrome fix: pause/resume every 14 seconds to prevent silent stop
   * on long utterances or when the tab is in background.
   */
  _startKeepAlive() {
    this._stopKeepAlive();
    this._keepAliveInterval = setInterval(() => {
      if (speechSynthesis.speaking && !speechSynthesis.paused) {
        speechSynthesis.pause();
        speechSynthesis.resume();
      }
    }, 14000);
  }

  _stopKeepAlive() {
    if (this._keepAliveInterval) {
      clearInterval(this._keepAliveInterval);
      this._keepAliveInterval = null;
    }
  }

  /**
   * Pause playback
   */
  pause() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.isPaused = true;
    this._stopKeepAlive();
    if (speechSynthesis.speaking && !speechSynthesis.paused) {
      speechSynthesis.pause();
    }
    this._emitStateChange('paused');
  }

  /**
   * Resume playback from the last chunk
   * @param {number} [fromChunk] - Optional: resume from specific chunk
   */
  resume(fromChunk) {
    if (!this.chunks.length) return;

    if (fromChunk !== undefined) {
      speechSynthesis.cancel();
      this.currentChunk = Math.max(0, Math.min(fromChunk, this.chunks.length - 1));
      this.isPlaying = false;
      this.isPaused = false;
      this.speak(this.chunks, this.currentChunk);
      return;
    }

    if (this.isPaused && speechSynthesis.paused) {
      this.isPlaying = true;
      this.isPaused = false;
      this._startKeepAlive();
      speechSynthesis.resume();
      this._emitStateChange('playing');
      return;
    }

    const chunk = this.currentChunk;
    this.speak(this.chunks, chunk);
  }

  /**
   * Stop playback entirely
   */
  stop() {
    this.isPlaying = false;
    this.isPaused = false;
    this._stopKeepAlive();
    speechSynthesis.cancel();
    this._emitStateChange('stopped');
  }

  /**
   * Skip forward one chunk
   */
  skipForward() {
    if (this.currentChunk < this.chunks.length - 1) {
      speechSynthesis.cancel();
      this.resume(this.currentChunk + 1);
    }
  }

  /**
   * Skip backward one chunk
   */
  skipBack() {
    speechSynthesis.cancel();
    this.resume(Math.max(0, this.currentChunk - 1));
  }

  /**
   * Jump to a specific chunk
   * @param {number} index
   */
  seekTo(index) {
    const clampedIndex = Math.max(0, Math.min(index, this.chunks.length - 1));
    speechSynthesis.cancel();
    this.resume(clampedIndex);
  }

  /**
   * Set playback rate
   * @param {number} rate - 0.1 to 10
   */
  setRate(rate) {
    this.rate = Math.max(0.1, Math.min(10, rate));
    // If currently playing, restart current chunk with new rate
    if (this.isPlaying) {
      speechSynthesis.cancel();
      this._speakCurrentChunk();
    }
  }

  /**
   * Set voice
   * @param {SpeechSynthesisVoice} voice
   */
  setVoice(voice) {
    this.voice = voice;
    if (this.isPlaying) {
      speechSynthesis.cancel();
      this._speakCurrentChunk();
    }
  }

  /**
   * Set language
   * @param {string} lang - ISO 639-1 code
   */
  setLanguage(lang) {
    this.language = lang;
  }

  /**
   * Get current progress as fraction 0-1
   */
  get progress() {
    if (this.chunks.length === 0) return 0;
    return this.currentChunk / this.chunks.length;
  }

  /**
   * Get current state string
   */
  get state() {
    if (this.isPlaying) return 'playing';
    if (this.isPaused) return 'paused';
    return 'stopped';
  }

  /**
   * Internal: handle end of all chunks
   */
  _finish() {
    this.isPlaying = false;
    this.isPaused = false;
    this._stopKeepAlive();
    if (this.onFinish) this.onFinish();
    this._emitStateChange('stopped');
  }

  _emitStateChange(state) {
    if (this.onStateChange) this.onStateChange(state);
  }

  /**
   * Cleanup — call when done with the engine
   */
  destroy() {
    this.stop();
    this.onChunkStart = null;
    this.onChunkEnd = null;
    this.onWordBoundary = null;
    this.onFinish = null;
    this.onStateChange = null;
    this.onError = null;
  }
}
