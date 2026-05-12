/**
 * google-tts.js - Google Translate Audio TTS Provider
 * Uses Google Translate free API for natural-sounding voices
 */

export class GoogleTranslateTTS {
  constructor() {
    this.isPlaying = false;
    this.currentAudio = null;
    this.rate = 1.0;
    this.maxChars = 180;
  }

  /**
   * Synthesize text and return audio element ready to play
   */
  async synthesize(text, lang = 'es') {
    if (!text || text.trim().length === 0) return null;

    const [firstSegment] = this._splitIntoSegments(text);
    if (!firstSegment) return null;

    return this._createAudio(firstSegment, lang);
  }

  /**
   * Play a text chunk through Google Translate's audio endpoint.
   * The endpoint does not support browser fetch/CORS, so audio must be loaded
   * directly by the media element.
   */
  async play(text, lang = 'es', isCancelled = () => false) {
    const segments = this._splitIntoSegments(text);
    if (segments.length === 0) return;

    this.isPlaying = true;

    try {
      for (const segment of segments) {
        if (isCancelled()) break;
        await this._playSegment(segment, lang, isCancelled);
      }
    } finally {
      this.isPlaying = false;
    }
  }

  _createAudio(text, lang) {
    const params = new URLSearchParams({
      client: 'gtx',
      q: text,
      tl: lang,
    });

    const audio = new Audio(`https://translate.google.com/translate_tts?${params}`);
    audio.preload = 'auto';
    audio.playbackRate = this.rate;
    return audio;
  }

  async _playSegment(text, lang, isCancelled) {
    const urls = this._getAudioUrls(text, lang);
    let lastError = null;

    for (const url of urls) {
      if (isCancelled()) return;

      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.playbackRate = this.rate;
      this.currentAudio = audio;

      try {
        await this._playAudio(audio, isCancelled);
        return;
      } catch (err) {
        lastError = err;
        console.warn(`Endpoint ${url} failed:`, err);
      }
    }

    throw lastError || new Error('All Google Translate endpoints failed');
  }

  _getAudioUrls(text, lang) {
    const params = new URLSearchParams({
      client: 'gtx',
      q: text,
      tl: lang,
    });

    return [
      `https://translate.google.com/translate_tts?${params}`,
      `https://translate.google.com.br/translate_tts?${params}`,
    ];
  }

  _playAudio(audio, isCancelled) {
    return new Promise((resolve, reject) => {
      let cancelTimer = null;
      const cleanup = () => {
        if (cancelTimer) clearInterval(cancelTimer);
        audio.onended = null;
        audio.onerror = null;
      };

      audio.onended = () => {
        cleanup();
        resolve();
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error('Google Translate audio could not be loaded'));
      };

      cancelTimer = setInterval(() => {
        if (!isCancelled()) return;
        audio.pause();
        cleanup();
        resolve();
      }, 100);

      audio.play().catch((err) => {
        cleanup();
        if (isCancelled()) resolve();
        else reject(err);
      });
    });
  }

  /**
   * Split text into URL-safe speech segments.
   */
  _splitIntoSegments(text) {
    const sentences = text
      .replace(/\s+/g, ' ')
      .match(/[^.!?;:]+[.!?;:]?|[^.!?;:]+$/g) || [text];
    const segments = [];

    for (const sentence of sentences.map(s => s.trim()).filter(Boolean)) {
      if (sentence.length <= this.maxChars) {
        segments.push(sentence);
        continue;
      }

      let current = '';
      for (const word of sentence.split(/\s+/)) {
        const next = current ? `${current} ${word}` : word;
        if (next.length > this.maxChars && current) {
          segments.push(current);
          current = word;
        } else {
          current = next;
        }
      }
      if (current) segments.push(current);
    }

    return segments;
  }

  /**
   * Set playback rate
   */
  setRate(rate) {
    this.rate = Math.max(0.5, Math.min(2.0, rate));
    if (this.currentAudio) {
      this.currentAudio.playbackRate = this.rate;
    }
  }

  /**
   * Stop playback
   */
  stop() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    this.isPlaying = false;
  }

  /**
   * Check if available
   */
  async isAvailable() {
    const audio = this._createAudio('test', 'en');
    return Boolean(audio.canPlayType('audio/mpeg'));
  }

  /**
   * Get supported languages
   */
  getLanguages() {
    return [
      { code: 'es', name: '🇪🇸 Español' },
      { code: 'en', name: '🇬🇧 English' },
      { code: 'fr', name: '🇫🇷 Français' },
      { code: 'de', name: '🇩🇪 Deutsch' },
      { code: 'pt', name: '🇵🇹 Português' },
      { code: 'it', name: '🇮🇹 Italiano' },
      { code: 'ja', name: '🇯🇵 日本語' },
      { code: 'zh', name: '🇨🇳 中文' },
      { code: 'ko', name: '🇰🇷 한국어' },
      { code: 'ru', name: '🇷🇺 Русский' },
      { code: 'nl', name: '🇳🇱 Nederlands' },
      { code: 'pl', name: '🇵🇱 Polski' },
      { code: 'tr', name: '🇹🇷 Türkçe' },
      { code: 'ar', name: '🇸🇦 العربية' },
      { code: 'hi', name: '🇮🇳 हिन्दी' },
    ];
  }
}
