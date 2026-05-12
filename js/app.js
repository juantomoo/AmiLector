/**
 * app.js — Main Application Controller
 * Manages views, file upload, library, reader, TTS wiring, and settings.
 */

import { parseDocument } from './parser.js';
import {
  saveDocument, getDocument, getAllDocuments, deleteDocument,
  updateProgress, updateSettings, findDuplicate, getStorageUsage,
  setAppSetting, getAppSetting
} from './store.js';
import {
  TTSEngine, loadVoices, getBestVoiceForLanguage,
  groupVoicesByLanguage, getVoiceQuality, rankVoices
} from './reader.js';
import { GoogleTranslateTTS } from './google-tts.js';

// ─── State ─────────────────────────────────────
let currentDocId = null;
let currentDoc = null;
let allVoices = [];
let tts = new TTSEngine();
let googleTTS = new GoogleTranslateTTS();
let activeEngine = 'webspeech'; // 'webspeech' | 'google-translate'
let googleTTSAbort = null; // AbortController-like flag for stopping Google TTS loop
let autoScrollEnabled = true;
let isProgrammaticScroll = false;
let skipNextAutoScroll = false;
let programmaticScrollTimer = null;
let scrollPauseTimer = null;
let lastUploadedDocId = null;

function getReaderBody() {
  return document.getElementById('reader-body');
}

function getChunkElement(idx) {
  const el = document.querySelector(`[data-chunk-index="${idx}"]`);
  if (!el) {
    console.warn(`[AmiLector] No se encontró el chunk ${idx}`);
  }
  return el;
}

function scrollBodyTo(body, top) {
  if (!body) return;
  isProgrammaticScroll = true;
  clearTimeout(programmaticScrollTimer);
  body.scrollTop = top;
  programmaticScrollTimer = setTimeout(() => {
    isProgrammaticScroll = false;
  }, 300);
}

function scrollChunkIntoView(idx, force = false) {
  if (!autoScrollEnabled && !force) return;
  const body = getReaderBody();
  const el = getChunkElement(idx);
  if (!body || !el) return;

  const bodyRect = body.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const elementTop = body.scrollTop + (elRect.top - bodyRect.top);
  const targetTop = elementTop - (body.clientHeight * 0.28);
  const maxTop = Math.max(0, body.scrollHeight - body.clientHeight);
  scrollBodyTo(body, Math.max(0, Math.min(targetTop, maxTop)));
}

// ─── PDF.js config ─────────────────────────────
async function initPDFJS() {
  const maxWait = 8000;
  const start = Date.now();
  while (!window.pdfjsLib && Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 200));
  }
}

// ─── Init ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await initPDFJS();
  detectBrowser();
  await loadTheme();
  await renderLibrary();
  initVoices();
  initDragDrop();
  initFileInput();
  initReaderControls();
  initSettingsPanel();
  initModals();
});

// ─── Browser Detection ─────────────────────────
function detectBrowser() {
  const isChrome = /Chrome/.test(navigator.userAgent) && !/Edge|OPR/.test(navigator.userAgent);
  if (!isChrome) {
    document.getElementById('chrome-banner').classList.remove('hidden');
  }
}

// ─── Theme ─────────────────────────────────────
async function loadTheme() {
  const theme = await getAppSetting('globalTheme', 'light');
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = theme === 'dark' ? '🌙' : theme === 'sepia' ? '📜' : '☀';
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) btn.textContent = icon;

  // Update active state in settings
  document.querySelectorAll('#theme-options .setting-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
}

// ─── View Management ───────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById(`view-${name}`);
  if (view) view.classList.add('active');
}

// ─── Library ───────────────────────────────────
async function renderLibrary() {
  const docs = await getAllDocuments();
  const grid = document.getElementById('library-grid');
  const empty = document.getElementById('empty-state');
  const badge = document.getElementById('storage-badge');

  if (docs.length === 0) {
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    grid.classList.remove('hidden');
    grid.innerHTML = docs.map(doc => createBookCard(doc)).join('');
    attachCardEvents();
  }

  // Storage badge
  const usage = await getStorageUsage();
  if (usage.documentCount > 0) {
    badge.textContent = `${usage.usedMB} MB · ${usage.documentCount} docs`;
    badge.classList.remove('hidden');
    if (usage.isWarning) badge.style.color = 'var(--danger)';
  } else {
    badge.classList.add('hidden');
  }
}

// Book cover colors based on title hash
function hashColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash % 360);
  return `hsl(${h}, 55%, 45%)`;
}

function createBookCard(doc) {
  const color = hashColor(doc.title);
  const initial = doc.title.charAt(0).toUpperCase();
  const progress = doc.chunksCount > 0
    ? Math.round((doc.readingProgress?.chunkIndex || 0) / doc.chunksCount * 100) : 0;
  const size = doc.fileSize < 1024 * 1024
    ? `${Math.round(doc.fileSize / 1024)} KB`
    : `${(doc.fileSize / (1024 * 1024)).toFixed(1)} MB`;
  const langFlag = { es: '🇪🇸', en: '🇬🇧', fr: '🇫🇷', de: '🇩🇪', pt: '🇧🇷', it: '🇮🇹', ja: '🇯🇵', zh: '🇨🇳' };
  const flag = langFlag[doc.language] || doc.language?.toUpperCase() || '';

  return `
    <div class="book-card" data-id="${doc.id}">
      <div class="book-cover" style="background:linear-gradient(135deg, ${color}, ${color}dd)">
        ${initial}
        <button class="book-menu-btn" data-id="${doc.id}" aria-label="Opciones">⋯</button>
      </div>
      <div class="book-info">
        <div class="book-title">${escapeHTML(doc.title)}</div>
        <div class="book-meta">
          <span>${flag}</span>
          <span>${size}</span>
          ${progress > 0 ? `<span>${progress}%</span>` : ''}
          ${doc.readingProgress?.bookmark ? `<span title="Marcador guardado">🔖</span>` : ''}
        </div>
        ${doc.chunksCount > 0 ? `
          <div class="book-progress-bar"><div class="fill" style="width:${progress}%"></div></div>
        ` : ''}
      </div>
      <div class="book-menu hidden" data-menu-id="${doc.id}">
        <button data-action="open" data-id="${doc.id}">📖 Abrir</button>
        <button data-action="info" data-id="${doc.id}">ℹ️ Info</button>
        <button data-action="delete" data-id="${doc.id}" class="delete-btn">🗑 Eliminar</button>
      </div>
    </div>`;
}

function attachCardEvents() {
  // Click on card → open document
  document.querySelectorAll('.book-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.book-menu-btn') || e.target.closest('.book-menu')) return;
      openDocument(card.dataset.id);
    });
  });

  // Menu buttons
  document.querySelectorAll('.book-menu-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      // Close all menus, then toggle this one
      document.querySelectorAll('.book-menu').forEach(m => m.classList.add('hidden'));
      const menu = document.querySelector(`.book-menu[data-menu-id="${id}"]`);
      if (menu) menu.classList.toggle('hidden');
    });
  });

  // Menu actions
  document.querySelectorAll('.book-menu button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const { action, id } = btn.dataset;
      document.querySelectorAll('.book-menu').forEach(m => m.classList.add('hidden'));
      if (action === 'open') openDocument(id);
      else if (action === 'delete') confirmDelete(id);
      else if (action === 'info') openDocument(id); // Just open for now
    });
  });

  // Close menus on outside click
  document.addEventListener('click', () => {
    document.querySelectorAll('.book-menu').forEach(m => m.classList.add('hidden'));
  });
}

async function openDocument(id) {
  currentDocId = id;
  currentDoc = await getDocument(id);
  if (!currentDoc) return;

  showView('reader');
  document.getElementById('reader-title').textContent = currentDoc.title;

  // Apply per-document settings
  const s = currentDoc.settings || {};
  document.documentElement.style.setProperty('--reader-font-size', (s.fontSize || 1.1) + 'rem');
  document.documentElement.setAttribute('data-font', s.fontFamily || 'serif');
  document.documentElement.setAttribute('data-width', s.textWidth || 'normal');
  if (s.theme) applyTheme(s.theme);
  updateSettingsUI(s);
  updateFontSizeDisplay(s.fontSize || 1.1);

  // Render content
  const content = document.getElementById('reader-content');
  content.innerHTML = currentDoc.htmlContent;
  document.documentElement.lang = currentDoc.language || 'es';

  // Check for bookmark
  if (currentDoc.readingProgress?.bookmark) {
    document.getElementById('btn-goto-bookmark').classList.remove('hidden');
  } else {
    document.getElementById('btn-goto-bookmark').classList.add('hidden');
  }

  // Setup TTS
  autoScrollEnabled = true;
  isProgrammaticScroll = false;
  setupTTS();

  // Restore scroll position
  const body = document.getElementById('reader-body');
  const pos = currentDoc.readingProgress?.scrollPosition || 0;
  setTimeout(() => body.scrollTop = pos, 100);
}

// ─── TTS Setup ─────────────────────────────────
async function setupTTS() {
  if (!currentDoc) return;

  tts.destroy();
  tts = new TTSEngine();
  tts.setLanguage(currentDoc.language || 'es');

  // Load voices and set best one
  if (allVoices.length === 0) {
    allVoices = await loadVoices();
  }
  populateVoiceSelect();

  if (activeEngine === 'webspeech') {
    const bestVoice = getBestVoiceForLanguage(allVoices, currentDoc.language || 'es');
    if (bestVoice) {
      tts.setVoice(bestVoice);
      const sel = document.getElementById('voice-select');
      sel.value = bestVoice.name;
    }
  }

  // Update seek bar
  const seek = document.getElementById('tts-seek');
  seek.max = currentDoc.chunks.length - 1;
  seek.value = currentDoc.readingProgress?.chunkIndex || 0;
  document.getElementById('tts-total').textContent = currentDoc.chunks.length;
  document.getElementById('tts-current').textContent =
    (currentDoc.readingProgress?.chunkIndex || 0) + 1;

  // TTS callbacks (used by Web Speech engine)
  tts.onChunkStart = (idx) => {
    highlightChunk(idx);
    if (skipNextAutoScroll) {
      skipNextAutoScroll = false;
    } else {
      scrollToChunk(idx);
    }
    seek.value = idx;
    document.getElementById('tts-current').textContent = idx + 1;
    document.getElementById('tts-status').textContent =
      `Leyendo ${idx + 1} de ${currentDoc.chunks.length}`;
    updateProgress(currentDocId, { chunkIndex: idx });
  };

  tts.onChunkEnd = (idx) => {
    clearHighlights();
  };

  tts.onWordBoundary = (chunkIdx, charIdx, charLen) => {
    highlightWord(chunkIdx, charIdx, charLen);
    scrollToActiveWord();
  };

  tts.onStateChange = (state) => {
    updatePlayButton(state);
  };

  tts.onFinish = () => {
    clearHighlights();
    document.getElementById('tts-status').textContent = '✓ Lectura completada';
  };
}

/** Update play button and status for any engine */
function updatePlayButton(state) {
  const btn = document.getElementById('btn-play');
  btn.textContent = state === 'playing' ? '⏸' : '▶';
  btn.setAttribute('aria-label', state === 'playing' ? 'Pausar' : 'Reproducir');
  document.getElementById('tts-status').textContent =
    state === 'playing' ? 'Leyendo...' :
    state === 'paused' ? 'Pausado' : 'Listo';
}

/** Populate voice select based on active engine */
function populateVoiceSelect() {
  const sel = document.getElementById('voice-select');
  sel.innerHTML = '';

  if (activeEngine === 'google-translate') {
    // Google Translate's public audio endpoint exposes language, not voice variants.
    const langs = googleTTS.getLanguages();
    const docLang = currentDoc?.language || 'es';
    sel.setAttribute('aria-label', 'Seleccionar idioma de Google Translate');
    sel.title = 'Google Translate usa una voz única por idioma. Para elegir voces de Google instaladas en Chrome, usa Web Speech.';
    for (const l of langs) {
      const opt = document.createElement('option');
      opt.value = l.code;
      opt.textContent = `${l.name} · voz única`;
      if (l.code === docLang) opt.selected = true;
      sel.appendChild(opt);
    }
    return;
  }

  // Web Speech: show system voices grouped by language
  sel.setAttribute('aria-label', 'Seleccionar voz');
  sel.title = 'Voces disponibles en el navegador o sistema';
  const groups = groupVoicesByLanguage(allVoices);
  const langNames = { es:'Español', en:'English', fr:'Français', de:'Deutsch', pt:'Português', it:'Italiano', ja:'日本語', zh:'中文', ko:'한국어', ru:'Русский', nl:'Nederlands', ar:'العربية' };

  for (const [lang, voices] of groups) {
    const group = document.createElement('optgroup');
    group.label = langNames[lang] || lang.toUpperCase();
    for (const v of voices) {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${getVoiceQuality(v)} ${v.name.replace(/Google |Microsoft /, '')}`;
      group.appendChild(opt);
    }
    sel.appendChild(group);
  }
}

// ─── Google Translate Audio Playback ────────────

/** Stop any running Google TTS playback */
function stopGoogleTTS() {
  if (googleTTSAbort) {
    googleTTSAbort.cancelled = true;
    googleTTSAbort = null;
  }
  googleTTS.stop();
  updatePlayButton('stopped');
}

async function playWithGoogleTranslate() {
  if (!currentDoc || !currentDoc.chunks.length) return;

  // Cancel any previous Google TTS loop
  stopGoogleTTS();

  const session = { cancelled: false };
  googleTTSAbort = session;

  const startFrom = currentDoc.readingProgress?.chunkIndex || 0;
  // Use the voice-select value as language (it stores lang codes for Google Translate)
  const sel = document.getElementById('voice-select');
  const lang = sel.value || currentDoc.language || 'es';

  updatePlayButton('playing');

  try {
    for (let i = startFrom; i < currentDoc.chunks.length; i++) {
      if (session.cancelled) return;

      const text = currentDoc.chunks[i];
      if (!text || !text.trim()) continue;

      // Update UI
      highlightChunk(i);
      if (!skipNextAutoScroll) scrollToChunk(i);
      else skipNextAutoScroll = false;
      document.getElementById('tts-seek').value = i;
      document.getElementById('tts-current').textContent = i + 1;
      document.getElementById('tts-status').textContent =
        `Leyendo ${i + 1} de ${currentDoc.chunks.length}`;
      updateProgress(currentDocId, { chunkIndex: i });
      if (currentDoc.readingProgress) currentDoc.readingProgress.chunkIndex = i;
      else currentDoc.readingProgress = { chunkIndex: i };

      try {
        await googleTTS.play(text, lang, () => session.cancelled);
      } catch (err) {
        if (session.cancelled) return;
        console.warn('Google TTS chunk', i, 'failed:', err);
        document.getElementById('tts-status').textContent =
          'Error cargando audio de Google';
        updatePlayButton('stopped');
        clearHighlights();
        return;
      }
    }

    if (!session.cancelled) {
      clearHighlights();
      document.getElementById('tts-status').textContent = '✓ Lectura completada';
      updatePlayButton('stopped');
    }
  } catch (err) {
    if (!session.cancelled) {
      console.error('Google Translate playback error:', err);
      document.getElementById('tts-status').textContent = '❌ Error en lectura';
      updatePlayButton('stopped');
    }
  } finally {
    if (googleTTSAbort === session) googleTTSAbort = null;
  }
}

// ─── Highlighting ──────────────────────────────
function highlightChunk(idx) {
  clearHighlights();
  const els = document.querySelectorAll(`[data-chunk-index="${idx}"]`);
  els.forEach(el => el.classList.add('chunk-active'));
}

function highlightWord(chunkIdx, charIdx, charLen) {
  // Remove previous word highlights
  document.querySelectorAll('.word-active').forEach(el => {
    const parent = el.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(el.textContent), el);
      parent.normalize();
    }
  });

  if (charLen <= 0) return;

  const els = document.querySelectorAll(`[data-chunk-index="${chunkIdx}"]`);
  if (els.length === 0) return;

  // Find the text within chunk elements and highlight the word
  let totalOffset = 0;
  for (const el of els) {
    const text = el.textContent;
    const localStart = charIdx - totalOffset;
    const wordEnd = Math.min(localStart + charLen, text.length);

    if (localStart >= 0 && localStart < text.length) {
      try {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
        let node;
        let nodeOffset = 0;
        
        while (node = walker.nextNode()) {
          const nodeLen = node.textContent.length;
          
          if (nodeOffset <= localStart && localStart < nodeOffset + nodeLen) {
            // Found the start node
            const startInNode = localStart - nodeOffset;
            const endInNode = Math.min(wordEnd - nodeOffset, nodeLen);
            
            const range = document.createRange();
            range.setStart(node, startInNode);
            range.setEnd(node, endInNode);
            
            // Use extractContents + appendChild for more reliable highlighting
            const contents = range.extractContents();
            const span = document.createElement('span');
            span.className = 'word-active';
            span.appendChild(contents);
            range.insertNode(span);
            return;
          }
          nodeOffset += nodeLen;
        }
      } catch (e) {
        // Fallback: create a simple span at the element level if text manipulation fails
        const span = document.createElement('span');
        span.className = 'word-active';
        span.textContent = text.substring(localStart, wordEnd);
        el.textContent = '';
        el.appendChild(document.createTextNode(text.substring(0, localStart)));
        el.appendChild(span);
        el.appendChild(document.createTextNode(text.substring(wordEnd)));
        return;
      }
      return;
    }
    totalOffset += text.length + 1;
  }
}

function clearHighlights() {
  document.querySelectorAll('.chunk-active').forEach(el => el.classList.remove('chunk-active'));
  document.querySelectorAll('.word-active').forEach(el => {
    const parent = el.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(el.textContent), el);
      parent.normalize();
    }
  });
}

/**
 * Programmatic scroll that won't trigger the "user scrolled" detection.
 * Sets a guard flag before scrolling and clears it after the animation settles.
 */
function programmaticScrollTo(body, top) {
  scrollBodyTo(body, top);
}

function scrollToChunk(idx, force = false) {
  scrollChunkIntoView(idx, force);
}

/**
 * Scroll to keep the currently highlighted word visible.
 * Continuously keeps the active word in the center-upper portion of the viewport.
 * Uses relative coordinates within the scrollable container.
 */
function scrollToActiveWord() {
  if (!autoScrollEnabled) return;
  const wordEl = document.querySelector('.word-active');
  if (!wordEl) return;
  const body = getReaderBody();
  if (!body) return;

  const wordRect = wordEl.getBoundingClientRect();
  const bodyRect = body.getBoundingClientRect();
  const wordTopInContainer = body.scrollTop + (wordRect.top - bodyRect.top);
  const wordBottomInContainer = wordTopInContainer + wordRect.height;
  const targetTop = wordTopInContainer - (body.clientHeight * 0.35);
  const maxTop = Math.max(0, body.scrollHeight - body.clientHeight);
  const clampedTarget = Math.max(0, Math.min(targetTop, maxTop));

  const topThreshold = body.scrollTop + (body.clientHeight * 0.18);
  const bottomThreshold = body.scrollTop + (body.clientHeight * 0.82);

  if (wordTopInContainer < topThreshold || wordBottomInContainer > bottomThreshold) {
    scrollBodyTo(body, clampedTarget);
  }
}

// ─── Reader Controls ───────────────────────────
function initReaderControls() {
  // Back button
  document.getElementById('btn-back').addEventListener('click', async () => {
    tts.stop();
    stopGoogleTTS();
    clearHighlights();
    if (currentDocId) {
      const body = document.getElementById('reader-body');
      await updateProgress(currentDocId, { scrollPosition: body.scrollTop });
    }
    currentDocId = null;
    currentDoc = null;
    showView('library');
    await renderLibrary();
  });

  // Play/Pause — dispatches to the active engine
  document.getElementById('btn-play').addEventListener('click', async () => {
    if (!currentDoc) return;

    if (activeEngine === 'google-translate') {
      // Toggle: if currently playing, stop; otherwise start
      if (googleTTSAbort) {
        stopGoogleTTS();
        clearHighlights();
      } else {
        await playWithGoogleTranslate();
      }
    } else {
      // Web Speech toggle
      if (tts.state === 'playing') {
        tts.pause();
      } else if (tts.state === 'paused') {
        tts.resume();
      } else {
        const startFrom = currentDoc.readingProgress?.chunkIndex || 0;
        tts.speak(currentDoc.chunks, startFrom);
      }
    }
  });

  // Skip — works for both engines
  document.getElementById('btn-skip-back').addEventListener('click', () => {
    if (activeEngine === 'google-translate' && googleTTSAbort) {
      const idx = Math.max(0, (currentDoc?.readingProgress?.chunkIndex || 0) - 1);
      updateProgress(currentDocId, { chunkIndex: idx });
      if (currentDoc.readingProgress) currentDoc.readingProgress.chunkIndex = idx;
      stopGoogleTTS();
      playWithGoogleTranslate();
    } else {
      tts.skipBack();
    }
  });
  document.getElementById('btn-skip-fwd').addEventListener('click', () => {
    if (activeEngine === 'google-translate' && googleTTSAbort) {
      const idx = Math.min((currentDoc?.chunks?.length || 1) - 1, (currentDoc?.readingProgress?.chunkIndex || 0) + 1);
      updateProgress(currentDocId, { chunkIndex: idx });
      if (currentDoc.readingProgress) currentDoc.readingProgress.chunkIndex = idx;
      stopGoogleTTS();
      playWithGoogleTranslate();
    } else {
      tts.skipForward();
    }
  });

  // Seek bar
  document.getElementById('tts-seek').addEventListener('input', (e) => {
    const idx = parseInt(e.target.value);
    document.getElementById('tts-current').textContent = idx + 1;

    if (activeEngine === 'google-translate') {
      // Update stored position; if playing, restart from there
      if (currentDoc?.readingProgress) currentDoc.readingProgress.chunkIndex = idx;
      updateProgress(currentDocId, { chunkIndex: idx });
      highlightChunk(idx);
      scrollToChunk(idx);
      if (googleTTSAbort) {
        stopGoogleTTS();
        playWithGoogleTranslate();
      }
    } else if (tts.state === 'playing') {
      tts.seekTo(idx);
    } else {
      highlightChunk(idx);
      scrollToChunk(idx);
      tts.currentChunk = idx;
    }
  });

  // Speed buttons — apply to both engines
  document.querySelectorAll('.tts-speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tts-speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const speed = parseFloat(btn.dataset.speed);
      tts.setRate(speed);
      googleTTS.setRate(speed);
    });
  });

  // Voice select — behavior depends on active engine
  document.getElementById('voice-select').addEventListener('change', (e) => {
    if (activeEngine === 'google-translate') {
      // Value is a language code; Google Translate does not expose voice variants.
      return;
    }
    const voice = allVoices.find(v => v.name === e.target.value);
    if (voice) tts.setVoice(voice);
  });

  // TTS Engine switcher
  document.getElementById('tts-engine')?.addEventListener('change', (e) => {
    // Stop both engines
    tts.stop();
    stopGoogleTTS();
    clearHighlights();

    activeEngine = e.target.value;
    console.log('TTS Engine switched to:', activeEngine);

    // Re-populate voice dropdown for the new engine
    populateVoiceSelect();
    updatePlayButton('stopped');
  });

  // Theme toggle
  document.getElementById('btn-theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'light' ? 'dark' : current === 'dark' ? 'sepia' : 'light';
    applyTheme(next);
    setAppSetting('globalTheme', next);
    if (currentDocId) updateSettings(currentDocId, { theme: next });
  });

  // Manual scroll detection → pause auto-scroll
  // Only triggers on genuine user scrolls, not on programmatic scrollTo calls.
  let lastScrollTop = 0;
  document.getElementById('reader-body').addEventListener('scroll', () => {
    if (isProgrammaticScroll) return; // Ignore our own scrollTo calls
    
    // Only pause auto-scroll if user actually scrolled (not just loading state)
    const currentScroll = document.getElementById('reader-body').scrollTop;
    if (Math.abs(currentScroll - lastScrollTop) > 5 && tts.state === 'playing') {
      autoScrollEnabled = false;
      document.getElementById('btn-return-pos').classList.add('visible');
      clearTimeout(scrollPauseTimer);
      scrollPauseTimer = setTimeout(() => {
        autoScrollEnabled = true;
        document.getElementById('btn-return-pos').classList.remove('visible');
      }, 5000);
    }
    lastScrollTop = currentScroll;
  }, { passive: true });

  // Return to position button
  document.getElementById('btn-return-pos').addEventListener('click', () => {
    autoScrollEnabled = true;
    document.getElementById('btn-return-pos').classList.remove('visible');
    scrollToChunk(tts.currentChunk, true);
  });

  // Bookmark buttons
  document.getElementById('btn-bookmark').addEventListener('click', async () => {
    if (!currentDocId) return;
    const body = document.getElementById('reader-body');
    const bookmark = { chunkIndex: tts.currentChunk, scrollPosition: body.scrollTop };
    await updateProgress(currentDocId, { bookmark });
    if (currentDoc) {
      if (!currentDoc.readingProgress) currentDoc.readingProgress = {};
      currentDoc.readingProgress.bookmark = bookmark;
    }
    
    // Feedback visual
    const btn = document.getElementById('btn-bookmark');
    const oldText = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => btn.textContent = oldText, 1500);
    
    document.getElementById('btn-goto-bookmark').classList.remove('hidden');
  });

  document.getElementById('btn-goto-bookmark').addEventListener('click', () => {
    if (!currentDoc || !currentDoc.readingProgress?.bookmark) return;
    const { chunkIndex, scrollPosition } = currentDoc.readingProgress.bookmark;

    const body = getReaderBody();
    skipNextAutoScroll = true;
    tts.seekTo(chunkIndex);
    scrollBodyTo(body, scrollPosition);
    autoScrollEnabled = true;
    document.getElementById('btn-return-pos').classList.remove('visible');
  });

  document.getElementById('reader-content').addEventListener('click', (e) => {
    const chunkEl = e.target.closest('[data-chunk-index]');
    if (!chunkEl || !currentDoc) return;

    const chunkIdx = parseInt(chunkEl.getAttribute('data-chunk-index'), 10);
    if (Number.isNaN(chunkIdx)) return;

    autoScrollEnabled = true;
    document.getElementById('btn-return-pos').classList.remove('visible');
    scrollToChunk(chunkIdx, true);
    tts.seekTo(chunkIdx);
  });

  // Save progress on page unload
  window.addEventListener('beforeunload', () => {
    if (currentDocId) {
      const body = document.getElementById('reader-body');
      updateProgress(currentDocId, {
        chunkIndex: tts.currentChunk,
        scrollPosition: body.scrollTop
      });
    }
  });
}

// ─── Voices Init ───────────────────────────────
async function initVoices() {
  allVoices = await loadVoices();
}

// ─── File Input & Drag-Drop ────────────────────
function initFileInput() {
  const fileInput = document.getElementById('file-input');

  document.getElementById('btn-add').addEventListener('click', () => fileInput.click());
  document.getElementById('btn-add-empty').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) await processFile(file);
    fileInput.value = '';
  });
}

function initDragDrop() {
  const overlay = document.getElementById('drop-overlay');
  let dragCounter = 0;

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    overlay.classList.add('active');
  });
  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; overlay.classList.remove('active'); }
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.remove('active');
    const file = e.dataTransfer.files[0];
    if (file) await processFile(file);
  });
}

// ─── File Processing ───────────────────────────
async function processFile(file) {
  // Check for duplicates
  const dup = await findDuplicate(file.name, file.size);
  if (dup) {
    const replace = confirm(`"${dup.title}" ya existe. ¿Reemplazar?`);
    if (replace) await deleteDocument(dup.id);
    else return;
  }

  // Show upload modal
  const modal = document.getElementById('modal-upload');
  modal.classList.add('active');
  resetUploadProgress();
  document.getElementById('upload-error').classList.add('hidden');
  document.getElementById('upload-actions').classList.add('hidden');
  document.getElementById('upload-title').textContent = `Procesando: ${file.name}`;

  try {
    const result = await parseDocument(file, (step, detail) => {
      updateUploadStep(step);
    });

    const doc = await saveDocument(result);
    lastUploadedDocId = doc.id;

    updateUploadStep('done');
    document.getElementById('upload-actions').classList.remove('hidden');
  } catch (err) {
    document.getElementById('upload-error').textContent = err.message;
    document.getElementById('upload-error').classList.remove('hidden');
    // Show close button
    document.getElementById('upload-actions').classList.remove('hidden');
    document.getElementById('btn-upload-open').classList.add('hidden');
  }
}

function resetUploadProgress() {
  document.querySelectorAll('#upload-progress .progress-step').forEach(step => {
    step.classList.remove('active', 'done', 'error');
    step.classList.add('pending');
  });
  document.getElementById('btn-upload-open').classList.remove('hidden');
}

function updateUploadStep(currentStep) {
  const steps = ['reading', 'extracting', 'normalizing', 'analyzing', 'segmenting', 'done'];
  const currentIdx = steps.indexOf(currentStep);

  steps.forEach((step, i) => {
    const el = document.querySelector(`[data-step="${step}"]`);
    if (!el) return;
    el.classList.remove('active', 'done', 'pending');
    if (i < currentIdx) el.classList.add('done');
    else if (i === currentIdx) el.classList.add('active');
    else el.classList.add('pending');
  });
}

// ─── Modals ────────────────────────────────────
function initModals() {
  // Upload modal actions
  document.getElementById('btn-upload-library').addEventListener('click', async () => {
    document.getElementById('modal-upload').classList.remove('active');
    showView('library');
    await renderLibrary();
  });

  document.getElementById('btn-upload-open').addEventListener('click', async () => {
    document.getElementById('modal-upload').classList.remove('active');
    if (lastUploadedDocId) await openDocument(lastUploadedDocId);
  });

  // Confirm modal
  document.getElementById('btn-confirm-cancel').addEventListener('click', () => {
    document.getElementById('modal-confirm').classList.remove('active');
  });
}

let confirmCallback = null;
function confirmDelete(docId) {
  document.getElementById('confirm-title').textContent = 'Eliminar documento';
  document.getElementById('confirm-content').textContent =
    '¿Estás seguro de que quieres eliminar este documento? Esta acción no se puede deshacer.';
  document.getElementById('modal-confirm').classList.add('active');

  const okBtn = document.getElementById('btn-confirm-ok');
  const newBtn = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newBtn, okBtn);

  newBtn.addEventListener('click', async () => {
    await deleteDocument(docId);
    document.getElementById('modal-confirm').classList.remove('active');
    await renderLibrary();
  });
}

// ─── Settings ──────────────────────────────────
function initSettingsPanel() {
  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('settings-overlay').classList.add('active');
  });

  document.getElementById('btn-close-settings').addEventListener('click', () => {
    document.getElementById('settings-overlay').classList.remove('active');
  });

  document.getElementById('settings-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      document.getElementById('settings-overlay').classList.remove('active');
    }
  });

  // Font size
  document.getElementById('btn-font-dec').addEventListener('click', () => changeFontSize(-0.1));
  document.getElementById('btn-font-inc').addEventListener('click', () => changeFontSize(0.1));

  // Font family
  document.querySelectorAll('#font-family-options .setting-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#font-family-options .setting-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.documentElement.setAttribute('data-font', btn.dataset.font);
      if (currentDocId) updateSettings(currentDocId, { fontFamily: btn.dataset.font });
    });
  });

  // Theme
  document.querySelectorAll('#theme-options .setting-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.theme);
      setAppSetting('globalTheme', btn.dataset.theme);
      if (currentDocId) updateSettings(currentDocId, { theme: btn.dataset.theme });
    });
  });

  // Text width
  document.querySelectorAll('#width-options .setting-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#width-options .setting-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.documentElement.setAttribute('data-width', btn.dataset.width);
      if (currentDocId) updateSettings(currentDocId, { textWidth: btn.dataset.width });
    });
  });
}

function changeFontSize(delta) {
  const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--reader-font-size')) || 1.1;
  const newSize = Math.max(0.7, Math.min(2.5, Math.round((current + delta) * 10) / 10));
  document.documentElement.style.setProperty('--reader-font-size', newSize + 'rem');
  updateFontSizeDisplay(newSize);
  if (currentDocId) updateSettings(currentDocId, { fontSize: newSize });
}

function updateFontSizeDisplay(size) {
  document.getElementById('font-size-display').textContent = size.toFixed(1) + 'rem';
}

function updateSettingsUI(settings) {
  // Font family
  document.querySelectorAll('#font-family-options .setting-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.font === (settings.fontFamily || 'serif'));
  });
  // Width
  document.querySelectorAll('#width-options .setting-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.width === (settings.textWidth || 'normal'));
  });
}

// ─── Utilities ─────────────────────────────────
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
