/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
      headers: { 'Content-Type': 'application/json' },
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
): Promise<{ text: string; finishReason?: string }> {
  const data = await safeFetchJson('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, question, shape, recentAnswers, highThinking }),
  });
  return { text: data.text, finishReason: data.finishReason };
}

export async function getEmbedding(text: string): Promise<number[]> {
  const data = await safeFetchJson('/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return data.embedding || [];
}
