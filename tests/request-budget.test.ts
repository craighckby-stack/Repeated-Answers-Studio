/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import { StudioRunner } from '../src/lib/studio/runner';
import { DEFAULT_SETTINGS } from '../src/lib/studio/types';

test('Request budget test: mock fetch call counts per attempt', async () => {
  const originalFetch = globalThis.fetch;
  let apiCallCount = 0;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/')) {
      apiCallCount++;
      if (url.includes('/api/generate')) {
        return new Response(JSON.stringify({
          text: `Generated response ${apiCallCount} with unique phrasing about space colonization challenges.`,
          coreIdea: `Idea ${apiCallCount}`,
          observableConsequence: 'Observable atmospheric measurements show steady nitrogen balance across all chambers.',
          counterevidence: 'Control tests reveal no differences in nitrogen isotope ratios over sixty days.',
          modelUsed: 'gemini-3.5-flash',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/embed')) {
        return new Response(JSON.stringify({
          embeddings: [[1, 0, 0], [0, 1, 0]]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/novelty-judge')) {
        return new Response(JSON.stringify({
          isNovel: true,
          reason: 'Novel idea',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/check-model')) {
        return new Response(JSON.stringify({ success: true, text: 'OK' }), { status: 200 });
      }
    }
    return originalFetch(input, init);
  };

  try {
    const settings = {
      ...DEFAULT_SETTINGS,
      target: 2,
      useLlmJudge: true,
      maxMisses: 10,
    };

    let states: any[] = [];
    const runner = new StudioRunner(settings, {
      onStateUpdate: (state) => {
        states.push(state);
      },
      onEntryAdded: () => {},
    });

    await runner.start();
    // Wait briefly for async loop
    await new Promise(r => setTimeout(r, 200));
    runner.stop();

    assert.ok(apiCallCount > 0, 'Should have made API calls');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
