/**
 * store.js — IndexedDB Persistence Layer
 * Uses idb-keyval for simple key-value storage of documents and settings.
 * All data stays local — no server, no backend.
 */

import { get, set, del, keys, values, createStore } from 'https://cdn.jsdelivr.net/npm/idb-keyval@6/dist/index.js';

// Create dedicated stores — each must use a UNIQUE database name
// because idb-keyval's createStore() creates one DB with one object store.
// Using the same DB name for different stores causes a NotFoundError.
const docStore = createStore('amilector-docs', 'documents');
const settingsStore = createStore('amilector-settings', 'app-settings');

/**
 * Generate a UUID for new documents
 */
function generateId() {
  return crypto.randomUUID();
}

/**
 * Save a new document to IndexedDB
 * @param {Object} doc - Document object from parser
 * @returns {Object} The saved document with generated id
 */
export async function saveDocument(doc) {
  const id = doc.id || generateId();
  const document = {
    id,
    title: doc.title || 'Sin título',
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    addedAt: Date.now(),
    language: doc.language || 'es',
    chunks: doc.chunks || [],
    htmlContent: doc.htmlContent || '',
    rawText: doc.rawText || '',
    readingProgress: {
      chunkIndex: 0,
      scrollPosition: 0,
      lastRead: null
    },
    settings: {
      fontSize: 1.1,
      fontFamily: 'serif',
      theme: 'light',
      textWidth: 'normal'
    }
  };

  await set(id, document, docStore);
  return document;
}

/**
 * Get a single document by ID
 * @param {string} id - Document UUID
 * @returns {Object|undefined} The document or undefined
 */
export async function getDocument(id) {
  return await get(id, docStore);
}

/**
 * Get all documents (metadata only for library view — no heavy content)
 * @returns {Array} Array of document metadata objects
 */
export async function getAllDocuments() {
  const allKeys = await keys(docStore);
  const docs = [];

  for (const key of allKeys) {
    const doc = await get(key, docStore);
    if (doc) {
      docs.push({
        id: doc.id,
        title: doc.title,
        fileName: doc.fileName,
        fileSize: doc.fileSize,
        addedAt: doc.addedAt,
        language: doc.language,
        chunksCount: doc.chunks?.length || 0,
        readingProgress: doc.readingProgress,
        settings: doc.settings
      });
    }
  }

  // Sort by last read (most recent first), then by addedAt
  docs.sort((a, b) => {
    const aTime = a.readingProgress?.lastRead || a.addedAt;
    const bTime = b.readingProgress?.lastRead || b.addedAt;
    return bTime - aTime;
  });

  return docs;
}

/**
 * Delete a document from the store
 * @param {string} id - Document UUID
 */
export async function deleteDocument(id) {
  await del(id, docStore);
}

/**
 * Update reading progress for a document
 * @param {string} id - Document UUID
 * @param {Object} progress - { chunkIndex, scrollPosition }
 */
export async function updateProgress(id, progress) {
  const doc = await get(id, docStore);
  if (!doc) return;

  doc.readingProgress = {
    ...doc.readingProgress,
    ...progress,
    lastRead: Date.now()
  };

  await set(id, doc, docStore);
}

/**
 * Update display settings for a document
 * @param {string} id - Document UUID
 * @param {Object} settings - { fontSize, fontFamily, theme, textWidth }
 */
export async function updateSettings(id, settings) {
  const doc = await get(id, docStore);
  if (!doc) return;

  doc.settings = {
    ...doc.settings,
    ...settings
  };

  await set(id, doc, docStore);
}

/**
 * Check if a document already exists (by fileName + fileSize)
 * @param {string} fileName
 * @param {number} fileSize
 * @returns {Object|null} Existing document metadata or null
 */
export async function findDuplicate(fileName, fileSize) {
  const allKeys = await keys(docStore);
  for (const key of allKeys) {
    const doc = await get(key, docStore);
    if (doc && doc.fileName === fileName && doc.fileSize === fileSize) {
      return { id: doc.id, title: doc.title };
    }
  }
  return null;
}

/**
 * Estimate total storage usage in bytes
 * @returns {Object} { usedBytes, usedMB, isWarning }
 */
export async function getStorageUsage() {
  let totalSize = 0;
  const allKeys = await keys(docStore);

  for (const key of allKeys) {
    const doc = await get(key, docStore);
    if (doc) {
      // Rough estimate: JSON stringified size
      totalSize += new Blob([JSON.stringify(doc)]).size;
    }
  }

  const usedMB = totalSize / (1024 * 1024);
  return {
    usedBytes: totalSize,
    usedMB: Math.round(usedMB * 10) / 10,
    isWarning: usedMB > 100,
    documentCount: allKeys.length
  };
}

/**
 * Save a global app setting (not per-document)
 * @param {string} key
 * @param {*} value
 */
export async function setAppSetting(key, value) {
  await set(key, value, settingsStore);
}

/**
 * Get a global app setting
 * @param {string} key
 * @param {*} defaultValue
 * @returns {*}
 */
export async function getAppSetting(key, defaultValue = null) {
  const val = await get(key, settingsStore);
  return val !== undefined ? val : defaultValue;
}
