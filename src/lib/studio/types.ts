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
}

export const MODELS = [
  'gemini-3.5-flash',
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
};

export function clampSettings(settings: StudioSettings): StudioSettings {
  const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, isNaN(val) ? min : val));
  return {
    ...settings,
    embeddingThreshold: clamp(settings.embeddingThreshold, 0.5, 0.99),
    localThreshold: clamp(settings.localThreshold, 0.5, 0.99),
    tagThreshold: clamp(settings.tagThreshold, 0.5, 0.99),
    target: Math.max(1, Math.round(settings.target || 1)),
    maxMisses: Math.max(1, Math.round(settings.maxMisses || 1)),
    perCommit: Math.max(1, Math.round(settings.perCommit || 1)),
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
