/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AnswerEntry } from './types';

// Normalize vector to unit length
export function normalizeVector(v: number[]): number[] {
  let norm = 0;
  for (let i = 0; i < v.length; i++) {
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map(val => val / norm);
}

// Compute cosine similarity between two vectors
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

// Tokenize and extract words for local Jaccard overlap
export function contentWords(text: string): Set<string> {
  const cleaned = text.toLowerCase().replace(/[^\w\s]/g, '');
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

export interface JudgeResult {
  isNovel: boolean;
  reason?: string;
  similarityScore?: number;
  closestMatchId?: string;
  closestMatchText?: string;
}

export function judgeNovelty(
  newText: string,
  newEmbedding: number[],
  keptEntries: AnswerEntry[],
  embeddingThreshold: number,
  localThreshold: number
): JudgeResult {
  const newWords = contentWords(newText);
  let maxEmbSim = 0;
  let maxLocSim = 0;
  let closestMatch: AnswerEntry | null = null;
  let matchType = '';

  for (const kept of keptEntries) {
    // 1. Embedding similarity
    if (newEmbedding.length > 0 && kept.embedding && kept.embedding.length > 0) {
      const embSim = cosineSimilarity(newEmbedding, kept.embedding);
      if (embSim > maxEmbSim) {
        maxEmbSim = embSim;
        closestMatch = kept;
        matchType = 'embedding';
      }
    }

    // 2. Local similarity
    if (kept.wordSet) {
      const locSim = jaccardSimilarity(newWords, new Set(kept.wordSet));
      if (locSim > maxLocSim) {
        maxLocSim = locSim;
        if (locSim >= maxEmbSim) {
          closestMatch = kept;
          matchType = 'local';
        }
      }
    }
  }

  // Check against thresholds
  if (maxEmbSim >= embeddingThreshold) {
    return {
      isNovel: false,
      reason: `Too similar semantically (similarity: ${(maxEmbSim * 100).toFixed(1)}% >= threshold ${(embeddingThreshold * 100).toFixed(0)}%)`,
      similarityScore: maxEmbSim,
      closestMatchId: closestMatch?.id,
      closestMatchText: closestMatch?.text,
    };
  }

  if (maxLocSim >= localThreshold) {
    return {
      isNovel: false,
      reason: `Too similar in wording (overlap: ${(maxLocSim * 100).toFixed(1)}% >= threshold ${(localThreshold * 100).toFixed(0)}%)`,
      similarityScore: maxLocSim,
      closestMatchId: closestMatch?.id,
      closestMatchText: closestMatch?.text,
    };
  }

  return { isNovel: true, similarityScore: Math.max(maxEmbSim, maxLocSim) };
}
