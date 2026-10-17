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

async function safeFetchJson(url: string, options: RequestInit): Promise<any> {
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
}

export async function checkModel(model: string): Promise<{ success: boolean; text?: string; error?: string }> {
  try {
    const data = await safeFetchJson('/api/check-model', {
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
  highThinking: boolean
): Promise<{ text: string; finishReason?: string; modelUsed?: string; fallbackUsed?: boolean }> {
  const data = await safeFetchJson('/api/generate', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ model, question, shape, recentAnswers, highThinking }),
  });
  return {
    text: data.text,
    finishReason: data.finishReason,
    modelUsed: data.modelUsed,
    fallbackUsed: data.fallbackUsed,
  };
}

export async function getEmbedding(text: string): Promise<number[]> {
  const data = await safeFetchJson('/api/embed', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ text }),
  });
  return data.embedding || [];
}

export async function llmNoveltyJudge(
  candidate: string,
  closestKept: string[],
  model = 'gemini-3.5-flash-lite'
): Promise<{ isNovel: boolean; reason: string }> {
  try {
    const data = await safeFetchJson('/api/novelty-judge', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ candidate, closestKept, model }),
    });
    return data;
  } catch {
    return { isNovel: true, reason: 'LLM judge unavailable – defaulting to novel' };
  }
}
