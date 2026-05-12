/**
 * google-tts.js - Google Translate Audio TTS Provider
 * Uses Google Translate free API for natural-sounding voices
 */

export class GoogleTranslateTTS {
  constructor() {
    this.isPlaying = false;
    this.currentAudio = null;
    this.rate = 1.0;
  }

  /**
   * Synthesize text and return audio element ready to play
   */
  async synthesize(text, lang = 'es') {
    if (!text || text.trim().length === 0) return null;

    try {
      // Split text into sentences to avoid URL length limits
      const sentences = this._splitIntoSentences(text);
      const audioBlobs = [];

      for (const sentence of sentences) {
        if (!sentence.trim()) continue;
        const blob = await this._fetchAudio(sentence, lang);
        if (blob) audioBlobs.push(blob);
      }

      if (audioBlobs.length === 0) {
        throw new Error('No audio generated from Google Translate');
      }

      // Combine all audio blobs
      const combined = new Blob(audioBlobs, { type: 'audio/mpeg' });
      const url = URL.createObjectURL(combined);
      const audio = new Audio(url);
      audio.playbackRate = this.rate;
      
      return audio;
    } catch (error) {
      console.error('Google TTS error:', error);
      throw error;
    }
  }

  /**
   * Fetch audio from Google Translate endpoint
   */
  async _fetchAudio(text, lang) {
    const params = new URLSearchParams({
      client: 'gtx',
      q: text,
      tl: lang,
    });

    // Try multiple endpoints for reliability
    const endpoints = [
      `https://translate.google.com/translate_tts?${params}`,
      `https://translate.google.com.br/translate_tts?${params}`,
    ];

    for (const url of endpoints) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });

        if (response.ok) {
          return await response.blob();
        }
      } catch (err) {
        console.warn(`Endpoint ${url} failed:`, err);
      }
    }

    throw new Error('All Google Translate endpoints failed');
  }

  /**
   * Split text into sentences
   */
  _splitIntoSentences(text) {
    // Split by period, exclamation, question mark
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    return sentences.map(s => s.trim()).filter(s => s.length > 0);
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
    }
    this.isPlaying = false;
  }

  /**
   * Check if available
   */
  async isAvailable() {
    try {
      const response = await fetch(
        'https://translate.google.com/translate_tts?client=gtx&q=test&tl=en',
        { method: 'HEAD' }
      );
      return response.ok;
    } catch {
      return false;
    }
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
