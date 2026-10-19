/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AnswerEntry, StudioSettings, DEFAULT_SETTINGS, clampSettings, RunState } from './types';
import { sanitizeContent } from './sanitizer';

const DB_NAME = 'RepeatedAnswersStudioDB';
const DB_VERSION = 1;
const STORE_RUNS = 'runs';
const STORE_ENTRIES = 'entries';
const STORE_SETTINGS = 'settings';

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('indexedDB is unavailable in this environment'));
    }
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

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ras_settings', JSON.stringify(localSettings));
    }

    if (typeof indexedDB !== 'undefined') {
      const db = await openDB();
      const tx = db.transaction(STORE_SETTINGS, 'readwrite');
      const store = tx.objectStore(STORE_SETTINGS);
      store.put({ key: 'current_settings', value: dbSettings });
    }
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

export async function loadSettings(): Promise<StudioSettings> {
  try {
    const local = typeof localStorage !== 'undefined' ? localStorage.getItem('ras_settings') : null;
    const parsedLocal = local ? JSON.parse(local) : {};

    if (typeof indexedDB === 'undefined') {
      return { ...DEFAULT_SETTINGS, ...parsedLocal };
    }

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
  if (typeof indexedDB === 'undefined') return;
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
  if (typeof indexedDB === 'undefined') return [];
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

export interface EmgMemoryDump {
  version: string;
  kernel: string;
  timestamp: number;
  settings: StudioSettings;
  runState: RunState;
  macroSynthesis?: any;
}

export function createMemoryDump(
  settings: StudioSettings,
  runState: RunState,
  macroSynthesis?: any
): string {
  const sanitizedTopic = sanitizeContent(settings.question).sanitized;
  const cleanSettings = {
    ...settings,
    question: sanitizedTopic,
    ghToken: '', // Never leak credentials in exported state dumps
    appAccessToken: '',
  };

  const dump: EmgMemoryDump = {
    version: '1.0.0-emg-core',
    kernel: 'EMG-KERNEL-v0.3',
    timestamp: Date.now(),
    settings: cleanSettings,
    runState: {
      ...runState,
      entries: runState.entries.map((e) => ({
        ...e,
        text: sanitizeContent(e.text || '').sanitized,
      })),
    },
    macroSynthesis: macroSynthesis || undefined,
  };

  return JSON.stringify(dump, null, 2);
}

export function parseMemoryDump(rawJson: string): EmgMemoryDump {
  let parsed: any;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Invalid JSON format in memory backup file.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Memory dump is not a valid JSON object.');
  }

  const rawSettings = parsed.settings || {};
  const settings = clampSettings({
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    ghToken: '',
    appAccessToken: '',
  });

  const rawEntries = Array.isArray(parsed.runState?.entries)
    ? parsed.runState.entries
    : Array.isArray(parsed.entries)
    ? parsed.entries
    : [];

  const entries: AnswerEntry[] = rawEntries.map((e: any, idx: number) => ({
    id: e.id || `restored-${idx}-${Date.now()}`,
    runId: e.runId || 'restored-run',
    index: typeof e.index === 'number' ? e.index : idx + 1,
    text: typeof e.text === 'string' ? e.text : '',
    coreIdea: typeof e.coreIdea === 'string' ? e.coreIdea : undefined,
    observableConsequence: typeof e.observableConsequence === 'string' ? e.observableConsequence : undefined,
    counterevidence: typeof e.counterevidence === 'string' ? e.counterevidence : undefined,
    persona: typeof e.persona === 'string' ? e.persona : undefined,
    status: e.status === 'kept' ? 'kept' : e.status === 'error' ? 'error' : 'rejected',
    timestamp: typeof e.timestamp === 'number' ? e.timestamp : Date.now(),
    modelUsed: e.modelUsed || 'restored',
    shannonEntropy: typeof e.shannonEntropy === 'number' ? e.shannonEntropy : undefined,
    emgAuditPassed: typeof e.emgAuditPassed === 'boolean' ? e.emgAuditPassed : undefined,
  }));

  const keptCount = entries.filter((e) => e.status === 'kept').length;
  const rejectedCount = entries.filter((e) => e.status === 'rejected').length;

  const runState: RunState = {
    runId: parsed.runState?.runId || `run-restored-${Date.now()}`,
    status: 'idle',
    target: typeof parsed.runState?.target === 'number' ? parsed.runState.target : settings.target,
    entries,
    keptCount,
    rejectedCount,
    errorCount: 0,
    consecutiveMisses: 0,
    startTime: parsed.runState?.startTime || Date.now(),
    lastCommitBatch: 1,
    commitStatus: 'idle',
  };

  return {
    version: parsed.version || '1.0.0-emg-core',
    kernel: parsed.kernel || 'EMG-KERNEL-v0.3',
    timestamp: parsed.timestamp || Date.now(),
    settings,
    runState,
    macroSynthesis: parsed.macroSynthesis || null,
  };
}

