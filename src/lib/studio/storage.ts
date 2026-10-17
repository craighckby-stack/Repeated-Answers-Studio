/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AnswerEntry, StudioSettings, DEFAULT_SETTINGS } from './types';

const DB_NAME = 'RepeatedAnswersStudioDB';
const DB_VERSION = 1;
const STORE_RUNS = 'runs';
const STORE_ENTRIES = 'entries';
const STORE_SETTINGS = 'settings';

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_RUNS)) {
        db.createObjectStore(STORE_RUNS, { keyPath: 'runId' });
      }
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        const store = db.createObjectStore(STORE_ENTRIES, { keyPath: 'id' });
        store.createIndex('runId', 'runId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
    };
  });
}

export async function saveSettings(settings: StudioSettings): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_SETTINGS, 'readwrite');
    const store = tx.objectStore(STORE_SETTINGS);

    const dbSettings = { ...settings };
    const localSettings = { ...settings };

    if (!settings.rememberSecrets) {
      dbSettings.ghToken = '';
      dbSettings.appAccessToken = '';
      localSettings.ghToken = '';
      localSettings.appAccessToken = '';
    } else {
      // When rememberSecrets is true, store token in IndexedDB only, never in localStorage
      localSettings.ghToken = '';
      localSettings.appAccessToken = '';
    }

    store.put({ key: 'current_settings', value: dbSettings });
    localStorage.setItem('ras_settings', JSON.stringify(localSettings));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

export async function loadSettings(): Promise<StudioSettings> {
  try {
    const local = localStorage.getItem('ras_settings');
    const parsedLocal = local ? JSON.parse(local) : {};
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_SETTINGS, 'readonly');
      const store = tx.objectStore(STORE_SETTINGS);
      const req = store.get('current_settings');
      req.onsuccess = () => {
        const stored = req.result?.value || {};
        // If rememberSecrets is false, ensure tokens are not restored from IDB
        const remember = stored.rememberSecrets ?? parsedLocal.rememberSecrets ?? DEFAULT_SETTINGS.rememberSecrets;
        if (!remember) {
          stored.ghToken = '';
          stored.appAccessToken = '';
        }
        resolve({ ...DEFAULT_SETTINGS, ...parsedLocal, ...stored });
      };
      req.onerror = () => resolve({ ...DEFAULT_SETTINGS, ...parsedLocal });
    });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveRunArchive(runId: string, entries: AnswerEntry[], metadata: any): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_RUNS, STORE_ENTRIES], 'readwrite');
    const runStore = tx.objectStore(STORE_RUNS);
    runStore.put({ runId, timestamp: Date.now(), ...metadata });

    const entryStore = tx.objectStore(STORE_ENTRIES);
    for (const entry of entries) {
      entryStore.put(entry);
    }
  } catch (err) {
    console.error('Failed to save run archive:', err);
  }
}

export async function loadArchivedRunEntries(runId: string): Promise<AnswerEntry[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_ENTRIES, 'readonly');
      const store = tx.objectStore(STORE_ENTRIES);
      const index = store.index('runId');
      const req = index.getAll(runId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}
