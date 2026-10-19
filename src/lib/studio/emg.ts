/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AnswerEntry } from './types';
import { calculateShannonEntropy, sanitizeContent, SanitizationResult } from './sanitizer';

export { calculateShannonEntropy, sanitizeContent, type SanitizationResult };

/**
 * Result of the EMG Epistemic Audit.
 */
export interface EmgAuditResult {
  ok: boolean;
  entropy: number;
  isSanitized: boolean;
  redactedCount: number;
  detectedSecrets: string[];
  reason?: string;
}

/**
 * Minimum entropy floor to reject repetitive platitude collapse.
 * Natural English prose typically ranges from 4.0 to 4.8 bits/char.
 * Collapsed or repetitive robotic phrases drop below 3.4 bits/char.
 */
export const EMG_DEFAULT_MIN_ENTROPY = 3.6;

/**
 * Audits a candidate response against EMG Mechanistic Density & Information Entropy standards.
 */
export function auditEmgCandidate(
  text: string,
  coreIdea: string,
  minEntropy = EMG_DEFAULT_MIN_ENTROPY
): EmgAuditResult {
  if (!text || text.trim().length < 40) {
    return {
      ok: false,
      entropy: 0,
      isSanitized: true,
      redactedCount: 0,
      detectedSecrets: [],
      reason: 'EMG Mass Preservation: Output length too brief (< 40 characters)',
    };
  }

  // 1. Edge Security & High-Entropy Token Sanitization
  const combined = `${coreIdea}\n${text}`;
  const sanResult = sanitizeContent(combined);
  const entropy = calculateShannonEntropy(text);

  // 2. Information Density Floor Check
  if (entropy < minEntropy) {
    return {
      ok: false,
      entropy,
      isSanitized: sanResult.redactedCount === 0,
      redactedCount: sanResult.redactedCount,
      detectedSecrets: sanResult.detectedSecrets,
      reason: `EMG Entropy Floor: Low information density (${entropy.toFixed(2)} < ${minEntropy.toFixed(2)} bits/char)`,
    };
  }

  return {
    ok: true,
    entropy,
    isSanitized: sanResult.redactedCount === 0,
    redactedCount: sanResult.redactedCount,
    detectedSecrets: sanResult.detectedSecrets,
  };
}

/**
 * EMG Self-Stopping Engine: evaluates whether the probe loop has achieved
 * consensus saturation or hit an entropy collapse plateau.
 */
export function evaluateEmgSelfStopping(
  entries: AnswerEntry[],
  consecutiveMisses: number,
  maxMisses: number
): { shouldHalt: boolean; reason?: string } {
  // Hard limit on consecutive rejections
  if (consecutiveMisses >= maxMisses) {
    return {
      shouldHalt: true,
      reason: `EMG Halt: Consensus saturation reached (${consecutiveMisses} consecutive rejections with 0 novel yield).`,
    };
  }

  // Check for entropy decay plateau across the last 8 entries
  if (entries.length >= 10 && consecutiveMisses >= 8) {
    const recent = entries.slice(-6);
    const entropies = recent
      .map(e => e.text ? calculateShannonEntropy(e.text) : 0)
      .filter(h => h > 0);

    if (entropies.length >= 4) {
      const avg = entropies.reduce((a, b) => a + b, 0) / entropies.length;
      const variance = entropies.reduce((acc, h) => acc + Math.pow(h - avg, 2), 0) / entropies.length;

      // When the model repeats variations with near-zero information variance and consecutive misses
      if (variance < 0.005 && avg < 3.8) {
        return {
          shouldHalt: true,
          reason: `EMG Halt: Semantic mode collapse detected (information entropy flatlined at ${avg.toFixed(2)} bits/char with variance ${variance.toFixed(4)}).`,
        };
      }
    }
  }

  return { shouldHalt: false };
}

/**
 * EMG Epistemic Constraint Selector: selects the most diverse negative constraints
 * from previous entries to guide future model prompts without context bloat.
 */
export function selectEmgNegativeConstraints(
  keptEntries: AnswerEntry[],
  rejectedEntries: AnswerEntry[],
  maxConstraints = 25
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  // Prioritize kept core ideas
  for (let i = keptEntries.length - 1; i >= 0 && candidates.length < maxConstraints; i--) {
    const core = keptEntries[i]?.coreIdea?.trim();
    if (core && !seen.has(core.toLowerCase())) {
      seen.add(core.toLowerCase());
      candidates.push(core);
    }
  }

  // Then add distinct rejected ideas that were rejected for similarity to avoid re-triggering them
  for (let i = rejectedEntries.length - 1; i >= 0 && candidates.length < maxConstraints; i--) {
    const core = rejectedEntries[i]?.coreIdea?.trim();
    if (core && !seen.has(core.toLowerCase()) && core.length >= 10) {
      seen.add(core.toLowerCase());
      candidates.push(core);
    }
  }

  return candidates;
}
