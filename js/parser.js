/**
 * parser.js — Document Ingestion & Text Normalization
 * Handles PDF, DOCX, TXT, and Markdown files.
 * Normalizes extracted text into semantic HTML and TTS-ready chunks.
 */

// franc-min returns ISO 639-3 codes — map to ISO 639-1 for Web Speech API
const ISO_639_3_TO_1 = {
  'spa': 'es', 'eng': 'en', 'fra': 'fr', 'deu': 'de', 'por': 'pt',
  'ita': 'it', 'cat': 'ca', 'nld': 'nl', 'rus': 'ru', 'pol': 'pl',
  'jpn': 'ja', 'zho': 'zh', 'kor': 'ko', 'ara': 'ar', 'hin': 'hi',
  'tur': 'tr', 'swe': 'sv', 'nor': 'no', 'dan': 'da', 'fin': 'fi',
  'ces': 'cs', 'ron': 'ro', 'hun': 'hu', 'ell': 'el', 'heb': 'he',
  'tha': 'th', 'vie': 'vi', 'ind': 'id', 'msa': 'ms', 'ukr': 'uk',
  'bul': 'bg', 'hrv': 'hr', 'slk': 'sk', 'slv': 'sl', 'est': 'et',
  'lav': 'lv', 'lit': 'lt', 'gle': 'ga', 'eus': 'eu', 'glg': 'gl',
  'und': 'es'  // undetermined defaults to Spanish
};

/**
 * Main entry point — parse any supported document file
 * @param {File} file - File object from input or drag-drop
 * @param {Function} onProgress - Callback (step, detail)
 * @returns {Object} { title, language, chunks[], htmlContent, rawText, metadata }
 */
export async function parseDocument(file, onProgress = () => {}) {
  const ext = file.name.split('.').pop().toLowerCase();
  const supported = ['pdf', 'txt', 'docx', 'md'];

  if (!supported.includes(ext)) {
    throw new Error(`Formato no soportado: .${ext}. Usa PDF, TXT, DOCX o MD.`);
  }

  onProgress('reading', `Leyendo ${file.name}...`);

  let rawText = '';
  let htmlContent = '';

  switch (ext) {
    case 'pdf':
      onProgress('extracting', 'Extrayendo texto del PDF...');
      const pdfResult = await parsePDF(file);
      rawText = pdfResult.rawText;
      onProgress('normalizing', 'Normalizando texto...');
      htmlContent = normalizePDFText(pdfResult.pages);
      break;

    case 'docx':
      onProgress('extracting', 'Extrayendo texto del documento Word...');
      const docxResult = await parseDOCX(file);
      rawText = docxResult.rawText;
      htmlContent = docxResult.htmlContent;
      break;

    case 'txt':
      onProgress('extracting', 'Leyendo archivo de texto...');
      const txtResult = await parseTXT(file);
      rawText = txtResult;
      htmlContent = textToHTML(txtResult);
      break;

    case 'md':
      onProgress('extracting', 'Procesando Markdown...');
      const mdResult = await parseTXT(file);
      rawText = stripMarkdown(mdResult);
      htmlContent = markdownToHTML(mdResult);
      break;
  }

  // Validate extraction
  if (!rawText || rawText.trim().length < 10) {
    throw new Error(
      'No se pudo extraer texto del documento. ' +
      (ext === 'pdf'
        ? 'El PDF puede estar protegido o contener solo imágenes escaneadas.'
        : 'El archivo parece estar vacío.')
    );
  }

  onProgress('analyzing', 'Detectando idioma...');
  const language = await detectLanguage(rawText);

  onProgress('segmenting', 'Preparando para lectura...');
  const segmentation = segmentIntoChunks(htmlContent);

  // Extract title from filename (remove extension)
  const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');

  onProgress('done', '¡Listo!');

  return {
    title,
    fileName: file.name,
    fileSize: file.size,
    language,
    chunks: segmentation.chunks,
    htmlContent: segmentation.htmlContent,
    rawText: rawText.substring(0, 5000), // Store trimmed raw for re-detection
    metadata: {
      format: ext,
      wordCount: rawText.split(/\s+/).length,
      charCount: rawText.length,
      chunksCount: segmentation.chunks.length
    }
  };
}


// ─── PDF Parsing ───────────────────────────────────────────────

async function parsePDF(file) {
  // PDF.js is loaded via script tag as pdfjsLib global
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) throw new Error('PDF.js no está cargado.');

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pages = [];
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    // Build text preserving positional information
    let pageText = '';
    let lastY = null;

    for (const item of textContent.items) {
      if (item.str === undefined) continue;

      const y = Math.round(item.transform[5]); // Y position

      // If Y changed significantly, it's a new line
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        pageText += '\n';
      } else if (lastY !== null && pageText.length > 0 && !pageText.endsWith(' ') && !pageText.endsWith('\n')) {
        // Same line, add space between items if needed
        if (item.str.trim().length > 0) {
          pageText += ' ';
        }
      }

      pageText += item.str;
      lastY = y;
    }

    pages.push(pageText);
    fullText += pageText + '\n\n';
  }

  return { pages, rawText: fullText };
}


// ─── PDF Text Normalization (CRITICAL ALGORITHM) ───────────────

function normalizePDFText(rawPages) {
  let text = rawPages.join('\n\n--- PAGE BREAK ---\n\n');

  // Step 1: Reconnect hyphenated words across line breaks
  text = text.replace(/(\w)-\n(\w)/g, '$1$2');

  // Step 2: Detect paragraph boundaries and join non-paragraph line breaks
  const lines = text.split('\n');
  const avgLineLength = calculateAverageLineLength(lines);
  const rebuilt = [];
  let currentParagraph = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nextLine = (i + 1 < lines.length) ? lines[i + 1]?.trim() : '';

    // Skip page break markers
    if (line === '--- PAGE BREAK ---') {
      if (currentParagraph.trim()) {
        rebuilt.push(currentParagraph.trim());
        currentParagraph = '';
      }
      continue;
    }

    // Empty line = definite paragraph break
    if (line === '') {
      if (currentParagraph.trim()) {
        rebuilt.push(currentParagraph.trim());
        currentParagraph = '';
      }
      continue;
    }

    // Check if this line ends a paragraph
    const endsWithPunctuation = /[.!?:;…»""\)]$/.test(line);
    const nextStartsWithUpper = /^[A-ZÁÉÍÓÚÑÄÖÜ]/.test(nextLine);
    const isShortLine = line.length < avgLineLength * 0.6;
    const nextHasIndent = /^\s{2,}/.test(lines[i + 1] || '');

    // Detect headings: ALL CAPS or very short non-punctuated lines
    const isAllCaps = line === line.toUpperCase() && line.length > 3 && /[A-ZÁÉÍÓÚ]/.test(line);
    const isLikelyHeading = (isAllCaps && line.length < 80) ||
      (isShortLine && !endsWithPunctuation && line.length > 2 && line.length < 60 && !line.match(/^[\d•\-\*]/));

    // Detect list items
    const isListItem = /^(?:[\•\-\*]|\d+[\.\)])\s/.test(line);

    if (isListItem) {
      if (currentParagraph.trim()) {
        rebuilt.push(currentParagraph.trim());
        currentParagraph = '';
      }
      rebuilt.push('• ' + line.replace(/^(?:[\•\-\*]|\d+[\.\)])\s*/, ''));
      continue;
    }

    if (isLikelyHeading) {
      if (currentParagraph.trim()) {
        rebuilt.push(currentParagraph.trim());
        currentParagraph = '';
      }
      rebuilt.push((isAllCaps ? '## ' : '### ') + capitalizeTitle(line));
      continue;
    }

    // Add line to current paragraph
    if (currentParagraph) {
      currentParagraph += ' ' + line;
    } else {
      currentParagraph = line;
    }

    // Check if we should break the paragraph
    if ((endsWithPunctuation && nextStartsWithUpper) || isShortLine || nextHasIndent) {
      rebuilt.push(currentParagraph.trim());
      currentParagraph = '';
    }
  }

  // Flush remaining paragraph
  if (currentParagraph.trim()) {
    rebuilt.push(currentParagraph.trim());
  }

  // Step 3: Normalize spaces
  const normalized = rebuilt.map(block => {
    let s = block;
    s = s.replace(/\s{2,}/g, ' ');          // Multiple spaces → one
    s = s.replace(/\s+([.,;:!?])/g, '$1');   // Space before punctuation → remove
    s = s.replace(/([.,;:!?])([A-Za-zÁÉÍÓÚáéíóú])/g, '$1 $2'); // Missing space after punctuation
    return s;
  });

  // Step 4: Convert to semantic HTML
  return normalized.map(block => {
    if (block.startsWith('## ')) {
      return `<h2>${escapeHTML(block.slice(3))}</h2>`;
    }
    if (block.startsWith('### ')) {
      return `<h3>${escapeHTML(block.slice(4))}</h3>`;
    }
    if (block.startsWith('• ')) {
      return `<li>${escapeHTML(block.slice(2))}</li>`;
    }
    return `<p>${escapeHTML(block)}</p>`;
  }).join('\n');
}

function calculateAverageLineLength(lines) {
  const nonEmpty = lines.filter(l => l.trim().length > 10);
  if (nonEmpty.length === 0) return 80;
  const total = nonEmpty.reduce((sum, l) => sum + l.trim().length, 0);
  return total / nonEmpty.length;
}

function capitalizeTitle(text) {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}


// ─── DOCX Parsing ──────────────────────────────────────────────

async function parseDOCX(file) {
  const mammoth = window.mammoth;
  if (!mammoth) throw new Error('Mammoth.js no está cargado.');

  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const htmlContent = result.value;

  // Extract plain text from the HTML
  const temp = document.createElement('div');
  temp.innerHTML = htmlContent;
  const rawText = temp.textContent || temp.innerText || '';

  return { htmlContent, rawText };
}


// ─── Plain Text Parsing ────────────────────────────────────────

async function parseTXT(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Error al leer el archivo de texto.'));

    // Try UTF-8 first
    reader.readAsText(file, 'UTF-8');
  });
}

function textToHTML(text) {
  const paragraphs = text.split(/\n\s*\n/);
  return paragraphs
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => `<p>${escapeHTML(p.replace(/\n/g, ' '))}</p>`)
    .join('\n');
}


// ─── Markdown Parsing ──────────────────────────────────────────

function stripMarkdown(md) {
  let text = md;
  text = text.replace(/^#{1,6}\s+/gm, '');       // Headers
  text = text.replace(/\*\*(.+?)\*\*/g, '$1');    // Bold
  text = text.replace(/\*(.+?)\*/g, '$1');         // Italic
  text = text.replace(/__(.+?)__/g, '$1');          // Bold alt
  text = text.replace(/_(.+?)_/g, '$1');            // Italic alt
  text = text.replace(/`(.+?)`/g, '$1');            // Inline code
  text = text.replace(/```[\s\S]*?```/g, '');       // Code blocks
  text = text.replace(/!\[.*?\]\(.*?\)/g, '');      // Images
  text = text.replace(/\[(.+?)\]\(.*?\)/g, '$1');   // Links
  text = text.replace(/^>\s+/gm, '');               // Blockquotes
  text = text.replace(/^[-*+]\s+/gm, '');           // Unordered lists
  text = text.replace(/^\d+\.\s+/gm, '');           // Ordered lists
  text = text.replace(/^---+$/gm, '');               // HR
  return text;
}

function markdownToHTML(md) {
  let html = md;

  // Code blocks → remove for reader (we're a text reader, not code viewer)
  html = html.replace(/```[\s\S]*?```/g, '');

  // Headers
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h2>$1</h2>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`(.+?)`/g, '<code>$1</code>');

  // Images → remove
  html = html.replace(/!\[.*?\]\(.*?\)/g, '');

  // Links → keep text
  html = html.replace(/\[(.+?)\]\(.*?\)/g, '$1');

  // Blockquotes
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote><p>$1</p></blockquote>');

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr>');

  // List items
  html = html.replace(/^[-*+]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');

  // Paragraphs: split by double newlines
  const blocks = html.split(/\n\s*\n/);
  html = blocks
    .map(block => {
      block = block.trim();
      if (!block) return '';
      // If already wrapped in an HTML tag, keep as-is
      if (/^<(h[1-6]|p|li|blockquote|hr|ul|ol)/.test(block)) return block;
      // Wrap bare text in <p>
      return `<p>${block.replace(/\n/g, ' ')}</p>`;
    })
    .filter(b => b.length > 0)
    .join('\n');

  return html;
}


// ─── Language Detection ────────────────────────────────────────

let francModule = null;

async function loadFranc() {
  if (!francModule) {
    try {
      francModule = await import('https://esm.sh/franc-min@6.2.0');
    } catch (e) {
      console.warn('Could not load franc-min for language detection:', e);
      return null;
    }
  }
  return francModule;
}

export async function detectLanguage(text) {
  const mod = await loadFranc();
  if (!mod) return 'es'; // Default to Spanish if franc fails

  const sample = text.substring(0, 1000);
  const code3 = mod.franc(sample);
  return ISO_639_3_TO_1[code3] || 'es';
}


// ─── Chunk Segmentation for TTS ────────────────────────────────

function segmentIntoChunks(htmlContent) {
  // Parse the HTML into elements
  const temp = document.createElement('div');
  temp.innerHTML = htmlContent;

  const elements = temp.querySelectorAll('p, h2, h3, h4, h5, h6, li, blockquote');
  const chunks = [];
  let chunkIdx = 0;

  for (const el of elements) {
    const text = el.textContent.trim();
    if (!text) continue;

    // Seguimiento por línea/párrafo: 1 chunk = 1 elemento HTML
    // Inyectamos el data-chunk-index directamente en el HTML
    el.setAttribute('data-chunk-index', chunkIdx);
    chunks.push(text);
    chunkIdx++;
  }

  return { chunks, htmlContent: temp.innerHTML };
}


// ─── Utilities ─────────────────────────────────────────────────

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
