/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

let currentAccessToken = '';
export function setAppAccessToken(token: string) {
  currentAccessToken = token || '';
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (currentAccessToken) {
    headers['x-access-token'] = currentAccessToken;
  }
  return headers;
}

async function safeFetchJsonWithRetry(url: string, options: RequestInit): Promise<any> {
  const delays = [2000, 4000, 8000, 16000, 32000];
  let attempt = 0;

  while (true) {
    try {
      const res = await fetch(url, options);
      const text = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text || `Server error (${res.status})` };
      }

      if (!res.ok) {
        const err = new Error(data.error || `Request failed with status ${res.status}`);
        (err as any).status = res.status;
        throw err;
      }
      return data;
    } catch (err: any) {
      const status = err.status || err.code || 500;
      const errMsg = (err.message || '').toLowerCase();
      const isNetworkError =
        err.name === 'TypeError' ||
        errMsg.includes('failed to fetch') ||
        errMsg.includes('network') ||
        errMsg.includes('load failed') ||
        errMsg.includes('econnrefused');
      const isRateLimitOrUnavailable =
        status === 429 ||
        status === 503 ||
        errMsg.includes('429') ||
        errMsg.includes('503') ||
        errMsg.includes('resource_exhausted') ||
        errMsg.includes('quota');

      if ((isRateLimitOrUnavailable || isNetworkError) && attempt < delays.length) {
        const delay = delays[attempt];
        attempt++;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (isRateLimitOrUnavailable) {
        const rateErr = new Error('Rate limit exceeded');
        (rateErr as any).status = 429;
        throw rateErr;
      }
      if (isNetworkError) {
        const netErr = new Error('Network connection failed');
        (netErr as any).status = 503;
        throw netErr;
      }
      throw err;
    }
  }
}

export async function checkModel(model: string): Promise<{ success: boolean; text?: string; error?: string }> {
  try {
    const data = await safeFetchJsonWithRetry('/api/check-model', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ model }),
    });
    return { success: true, text: data.text };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error during model check' };
  }
}

export async function generateAnswer(
  model: string,
  question: string,
  shape: string,
  recentAnswers: string[],
  recentIdeas: string[],
  highThinking: boolean,
  abstraction?: 'concrete' | 'balanced' | 'abstract'
): Promise<{
  text: string;
  coreIdea: string;
  observableConsequence: string;
  counterevidence: string;
  finishReason?: string;
  modelUsed?: string;
  fallbackUsed?: boolean;
}> {
  const data = await safeFetchJsonWithRetry('/api/generate', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ model, question, shape, recentAnswers, recentIdeas, highThinking, abstraction }),
  });
  return {
    text: data.text,
    coreIdea: data.coreIdea,
    observableConsequence: data.observableConsequence,
    counterevidence: data.counterevidence,
    finishReason: data.finishReason,
    modelUsed: data.modelUsed,
    fallbackUsed: data.fallbackUsed,
  };
}

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const data = await safeFetchJsonWithRetry('/api/embed', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ texts }),
  });
  return data.embeddings || [];
}

export async function getEmbedding(text: string): Promise<number[]> {
  const embs = await getEmbeddings([text]);
  return embs[0] || [];
}

export async function llmNoveltyJudge(
  candidate: string,
  closestKept: string[],
  candidateCore?: string,
  model = 'gemini-3.5-flash-lite'
): Promise<{ isNovel: boolean; reason: string; unavailable?: boolean }> {
  try {
    const data = await safeFetchJsonWithRetry('/api/novelty-judge', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        candidate,
        closestKept,
        candidateCore,
        model,
      }),
    });
    return {
      isNovel: Boolean(data.isNovel),
      reason: data.reason || 'No reason given',
    };
  } catch (err: any) {
    return {
      isNovel: false,
      unavailable: true,
      reason: 'LLM judge unavailable',
    };
  }
}
