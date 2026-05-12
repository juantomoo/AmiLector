// PDF.js loader - extracted from inline script to comply with Content Security Policy
import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs';
window.pdfjsLib = pdfjsLib;
