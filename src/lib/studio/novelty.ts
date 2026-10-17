/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AnswerEntry } from './types';

export function normalizeVector(v: number[]): number[] {
  let norm = 0;
  for (let i = 0; i < v.length; i++) {
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map(val => val / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export function contentWords(text: string): Set<string> {
  const cleaned = (text || '').toLowerCase().replace(/[^\w\s]/g, '');
  const tokens = cleaned.split(/\s+/).filter(t => t.length > 2);
  return new Set(tokens);
}

export function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1.0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

export interface GateResult {
  keep: boolean;
  reason?: string;
  similarityScore?: number;
  coreSimilarity?: number;
  closestMatchIndex?: number | null;
  closestMatchId?: string;
  closestMatchText?: string;
}

const normIdea = (idea?: string | null) => (idea || '').trim().toLowerCase();

export function evaluateGate(
  candidateText: string,
  textEmbedding: number[],
  coreIdea: string,
  coreEmbedding: number[],
  keptEntries: AnswerEntry[],
  settings: {
    embeddingThreshold: number;
    localThreshold: number;
    tagThreshold: number;
  }
): GateResult {
  const newWords = contentWords(candidateText);

  // 1. Full-text embedding cosine >= settings.embeddingThreshold
  let maxEmbSim = 0;
  let embClosest: AnswerEntry | null = null;
  if (textEmbedding && textEmbedding.length > 0) {
    for (const kept of keptEntries) {
      if (kept.embedding && kept.embedding.length > 0) {
        const sim = cosineSimilarity(textEmbedding, kept.embedding);
        if (sim > maxEmbSim) {
          maxEmbSim = sim;
          embClosest = kept;
        }
      }
    }
  }

  // 2. Local word overlap (Jaccard) >= settings.localThreshold
  let maxLocSim = 0;
  let locClosest: AnswerEntry | null = null;
  for (const kept of keptEntries) {
    if (kept.wordSet) {
      const loc = jaccardSimilarity(newWords, new Set(kept.wordSet));
      if (loc > maxLocSim) {
        maxLocSim = loc;
        locClosest = kept;
      }
    }
  }

  // 3. Normalized core idea exactly equal to a kept core idea
  const newNorm = normIdea(coreIdea);
  if (newNorm) {
    for (const kept of keptEntries) {
      if (normIdea(kept.coreIdea) === newNorm) {
        return {
          keep: false,
          reason: `Same core idea as #${kept.index}`,
          similarityScore: 1.0,
          coreSimilarity: 1.0,
          closestMatchIndex: kept.index,
          closestMatchId: kept.id,
          closestMatchText: kept.text,
        };
      }
    }
  }

  // 4. Core embedding cosine >= settings.tagThreshold
  let maxCoreSim = 0;
  let coreClosest: AnswerEntry | null = null;
  if (coreEmbedding && coreEmbedding.length > 0) {
    for (const kept of keptEntries) {
      if (kept.coreEmbedding && kept.coreEmbedding.length > 0) {
        const cSim = cosineSimilarity(coreEmbedding, kept.coreEmbedding);
        if (cSim > maxCoreSim) {
          maxCoreSim = cSim;
          coreClosest = kept;
        }
      }
    }
  }

  const thresholdPercent = Math.round(settings.tagThreshold * 100);
  const actualPercent = Math.round(maxCoreSim * 100);
  if (maxCoreSim >= settings.tagThreshold && coreClosest) {
    return {
      keep: false,
      reason: `Core idea too similar to #${coreClosest.index} (${actualPercent}% ≥ ${thresholdPercent}%)`,
      similarityScore: maxCoreSim,
      coreSimilarity: maxCoreSim,
      closestMatchIndex: coreClosest.index,
      closestMatchId: coreClosest.id,
      closestMatchText: coreClosest.text,
    };
  }

  if (maxEmbSim >= settings.embeddingThreshold && embClosest) {
    return {
      keep: false,
      reason: 'Full-text too similar',
      similarityScore: maxEmbSim,
      closestMatchIndex: embClosest.index,
      closestMatchId: embClosest.id,
      closestMatchText: embClosest.text,
    };
  }

  if (maxLocSim >= settings.localThreshold && locClosest) {
    return {
      keep: false,
      reason: 'Wording overlap too high',
      similarityScore: maxLocSim,
      closestMatchIndex: locClosest.index,
      closestMatchId: locClosest.id,
      closestMatchText: locClosest.text,
    };
  }

  return {
    keep: true,
    similarityScore: Math.max(maxEmbSim, maxLocSim),
    coreSimilarity: maxCoreSim,
  };
}
