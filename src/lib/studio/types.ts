/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface StudioSettings {
  question: string;
  engine: 'gemini' | 'sandbox';
  model: string;
  highThinking: boolean;
  shape: 'short' | 'note' | 'list';
  abstraction: 'concrete' | 'balanced' | 'abstract';
  target: number;
  embeddingThreshold: number; // 0.5 to 0.99 (default 0.85)
  localThreshold: number;     // 0.5 to 0.99 (default 0.75)
  tagThreshold: number;       // 0.5 to 0.99 (default 0.90)
  maxMisses: number;          // consecutive rejection limit before pause
  perCommit: number;          // batch size for GitHub commit
  rememberSecrets: boolean;   // off by default
  ghOwnerRepo: string;
  ghBranch: string;
  ghToken: string;
  appAccessToken: string;     // for server auth if APP_ACCESS_TOKEN is set
  useLlmJudge: boolean;       // LLM-as-judge novelty check validation step
  emgGatesEnabled: boolean;   // Enable EMG Enhanced Machine Gates engine
  emgSanitizeSecrets: boolean;// Redact API keys and high-entropy secrets (> 4.5)
  emgMinEntropy: number;      // Minimum Shannon entropy floor (bits/char)
  emgHaltOnDecay: boolean;    // Automatic self-stopping on entropy decay / saturation
  personaMode: string;        // 'rotate' (9 personas), 'none', or specific persona ID
}

export const MODELS = [
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-4-argon',
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash-lite',
];

export const DEFAULT_SETTINGS: StudioSettings = {
  question: 'What are the hidden risks and long-term consequences of human space colonization?',
  engine: 'gemini',
  model: 'gemini-3.5-flash',
  highThinking: false,
  shape: 'note',
  abstraction: 'balanced',
  target: 100,
  embeddingThreshold: 0.85,
  localThreshold: 0.75,
  tagThreshold: 0.90,
  maxMisses: 20,
  perCommit: 25,
  rememberSecrets: false,
  ghOwnerRepo: '',
  ghBranch: 'main',
  ghToken: '',
  appAccessToken: '',
  useLlmJudge: true,
  emgGatesEnabled: true,
  emgSanitizeSecrets: true,
  emgMinEntropy: 3.6,
  emgHaltOnDecay: true,
  personaMode: 'rotate',
};

export function clampSettings(settings: StudioSettings): StudioSettings {
  const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, isNaN(val) ? min : val));
  const validAbstractions = ['concrete', 'balanced', 'abstract'] as const;
  const abstraction = validAbstractions.includes(settings.abstraction as any)
    ? settings.abstraction
    : 'balanced';

  return {
    ...settings,
    abstraction,
    embeddingThreshold: clamp(settings.embeddingThreshold, 0.5, 0.99),
    localThreshold: clamp(settings.localThreshold, 0.5, 0.99),
    tagThreshold: clamp(settings.tagThreshold, 0.5, 0.99),
    target: Math.max(1, Math.round(settings.target || 1)),
    maxMisses: Math.max(1, Math.round(settings.maxMisses || 1)),
    perCommit: Math.max(1, Math.round(settings.perCommit || 1)),
    emgGatesEnabled: settings.emgGatesEnabled ?? true,
    emgSanitizeSecrets: settings.emgSanitizeSecrets ?? true,
    emgMinEntropy: clamp(settings.emgMinEntropy ?? 3.6, 2.5, 5.0),
    emgHaltOnDecay: settings.emgHaltOnDecay ?? true,
    personaMode: settings.personaMode || 'rotate',
  };
}

export interface AnswerEntry {
  id: string;
  runId: string;
  index: number;
  text: string;
  timestamp: number;
  embedding?: number[];
  tagEmbedding?: number[];
  coreEmbedding?: number[];
  wordSet?: string[];
  status: 'kept' | 'rejected' | 'error';
  coreIdea?: string | null;
  reason?: string;
  similarityScore?: number;
  tagSimilarity?: number | null;
  closestMatchId?: string;
  closestMatchIndex?: number | null;
  closestMatchText?: string;
  selectedModel?: string;
  modelUsed?: string;
  fallbackUsed?: boolean;
  observableConsequence?: string | null;
  counterevidence?: string | null;
  shannonEntropy?: number;
  sanitizedSecrets?: string[];
  emgAuditPassed?: boolean;
  persona?: string;
}

export interface RunState {
  runId: string;
  startTime: number;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'stopped' | 'rate_limited';
  target: number;
  keptCount: number;
  rejectedCount: number;
  errorCount: number;
  consecutiveMisses: number;
  entries: AnswerEntry[];
  error?: string;
  lastCommitBatch: number;
  commitStatus: 'idle' | 'committing' | 'success' | 'failed';
  commitError?: string;
}
