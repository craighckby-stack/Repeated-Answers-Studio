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
  tagSimilarity?: number | null;
  closestMatchId?: string;
  closestMatchIndex?: number | null;
  closestMatchText?: string;
}

const normIdea = (idea?: string | null) => (idea || '').trim().toLowerCase();

export function judgeNovelty(
  newText: string,
  newEmbedding: number[],
  newCoreIdea: string | null | undefined,
  newTagEmbedding: number[] | undefined,
  keptEntries: AnswerEntry[],
  embeddingThreshold: number,
  localThreshold: number,
  tagThreshold: number
): JudgeResult {
  // 1. Check exact normalized coreIdea match
  const newIdeaNorm = normIdea(newCoreIdea);
  if (newIdeaNorm) {
    for (const kept of keptEntries) {
      if (normIdea(kept.coreIdea) === newIdeaNorm) {
        return {
          isNovel: false,
          reason: `Same core idea as #${kept.index}`,
          similarityScore: 1.0,
          tagSimilarity: 1.0,
          closestMatchId: kept.id,
          closestMatchIndex: kept.index,
          closestMatchText: kept.text,
        };
      }
    }
  }

  // 2. Check tagEmbedding cosine similarity against tagThreshold
  let maxTagSim = 0;
  let tagClosestMatch: AnswerEntry | null = null;
  if (newTagEmbedding && newTagEmbedding.length > 0) {
    for (const kept of keptEntries) {
      if (kept.tagEmbedding && kept.tagEmbedding.length > 0) {
        const tSim = cosineSimilarity(newTagEmbedding, kept.tagEmbedding);
        if (tSim > maxTagSim) {
          maxTagSim = tSim;
          tagClosestMatch = kept;
        }
      }
    }
  }

  if (maxTagSim >= tagThreshold && tagClosestMatch) {
    return {
      isNovel: false,
      reason: `Same core idea as #${tagClosestMatch.index} (tag similarity ${(maxTagSim * 100).toFixed(0)}%)`,
      similarityScore: maxTagSim,
      tagSimilarity: maxTagSim,
      closestMatchId: tagClosestMatch.id,
      closestMatchIndex: tagClosestMatch.index,
      closestMatchText: tagClosestMatch.text,
    };
  }

  // 3. Existing embedding and local word overlap similarity
  const newWords = contentWords(newText);
  let maxEmbSim = 0;
  let maxLocSim = 0;
  let closestMatch: AnswerEntry | null = null;

  for (const kept of keptEntries) {
    if (newEmbedding.length > 0 && kept.embedding && kept.embedding.length > 0) {
      const embSim = cosineSimilarity(newEmbedding, kept.embedding);
      if (embSim > maxEmbSim) {
        maxEmbSim = embSim;
        closestMatch = kept;
      }
    }

    if (kept.wordSet) {
      const locSim = jaccardSimilarity(newWords, new Set(kept.wordSet));
      if (locSim > maxLocSim) {
        maxLocSim = locSim;
        if (locSim >= maxEmbSim) {
          closestMatch = kept;
        }
      }
    }
  }

  if (maxEmbSim >= embeddingThreshold) {
    return {
      isNovel: false,
      reason: `Too similar semantically (similarity: ${(maxEmbSim * 100).toFixed(1)}% >= threshold ${(embeddingThreshold * 100).toFixed(0)}%)`,
      similarityScore: maxEmbSim,
      tagSimilarity: maxTagSim > 0 ? maxTagSim : null,
      closestMatchId: closestMatch?.id,
      closestMatchIndex: closestMatch?.index,
      closestMatchText: closestMatch?.text,
    };
  }

  if (maxLocSim >= localThreshold) {
    return {
      isNovel: false,
      reason: `Too similar in wording (overlap: ${(maxLocSim * 100).toFixed(1)}% >= threshold ${(localThreshold * 100).toFixed(0)}%)`,
      similarityScore: maxLocSim,
      tagSimilarity: maxTagSim > 0 ? maxTagSim : null,
      closestMatchId: closestMatch?.id,
      closestMatchIndex: closestMatch?.index,
      closestMatchText: closestMatch?.text,
    };
  }

  return {
    isNovel: true,
    similarityScore: Math.max(maxEmbSim, maxLocSim),
    tagSimilarity: maxTagSim > 0 ? maxTagSim : null,
    closestMatchId: closestMatch?.id,
    closestMatchIndex: closestMatch?.index,
    closestMatchText: closestMatch?.text,
  };
}
