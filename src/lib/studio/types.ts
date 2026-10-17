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
  maxMisses: number;          // consecutive rejection limit before pause
  perCommit: number;          // batch size for GitHub commit
  rememberSecrets: boolean;   // off by default
  ghOwnerRepo: string;
  ghBranch: string;
  ghToken: string;
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
  maxMisses: 20,
  perCommit: 25,
  rememberSecrets: false,
  ghOwnerRepo: '',
  ghBranch: 'main',
  ghToken: '',
};

export interface AnswerEntry {
  id: string;
  runId: string;
  index: number;
  text: string;
  timestamp: number;
  embedding?: number[];
  wordSet?: string[];
  status: 'kept' | 'rejected';
  reason?: string;
  similarityScore?: number;
  closestMatchId?: string;
  closestMatchText?: string;
}

export interface RunState {
  runId: string;
  startTime: number;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'stopped' | 'rate_limited';
  target: number;
  keptCount: number;
  rejectedCount: number;
  consecutiveMisses: number;
  entries: AnswerEntry[];
  error?: string;
  lastCommitBatch: number;
  commitStatus: 'idle' | 'committing' | 'success' | 'failed';
  commitError?: string;
}
