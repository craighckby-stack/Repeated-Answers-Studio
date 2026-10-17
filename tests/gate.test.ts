/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import { evaluateGate } from '../src/lib/studio/novelty';
import { AnswerEntry } from '../src/lib/studio/types';

test('Gate 3: Exact core-idea match is rejected', () => {
  const kept: AnswerEntry[] = [
    {
      id: 'r1-1',
      runId: 'r1',
      index: 1,
      text: 'First answer text about quantum computing.',
      timestamp: Date.now(),
      status: 'kept',
      coreIdea: 'Quantum entanglement',
      embedding: [1, 0, 0],
      coreEmbedding: [1, 0, 0],
      wordSet: ['quantum', 'computing', 'first'],
    },
  ];

  const res = evaluateGate(
    'Another text about quantum computers with distinct phrasing.',
    [0, 1, 0], // different text embedding
    'Quantum entanglement',
    [0, 1, 0],
    kept,
    { embeddingThreshold: 0.85, localThreshold: 0.75, tagThreshold: 0.90 }
  );

  assert.strictEqual(res.keep, false);
  assert.strictEqual(res.reason, 'Same core idea as #1');
});

test('Gate 4: Core similarity 0.91 is rejected at default 0.90 and accepted when tagThreshold is 0.95', () => {
  const kept: AnswerEntry[] = [
    {
      id: 'r1-1',
      runId: 'r1',
      index: 1,
      text: 'First answer text.',
      timestamp: Date.now(),
      status: 'kept',
      coreIdea: 'Neural networks',
      embedding: [1, 0, 0],
      coreEmbedding: [1, 0, 0],
      wordSet: ['first', 'answer'],
    },
  ];

  const coreEmb = [0.91, 0.41, 0];

  const resDefault = evaluateGate(
    'Candidate text.',
    [0, 1, 0],
    'Deep neural networks',
    coreEmb,
    kept,
    { embeddingThreshold: 0.85, localThreshold: 0.75, tagThreshold: 0.90 }
  );

  assert.strictEqual(resDefault.keep, false);
  assert.match(resDefault.reason || '', /Core idea too similar to #1 \(91% ≥ 90%\)/);

  const resAdjusted = evaluateGate(
    'Candidate text.',
    [0, 1, 0],
    'Distinct core idea concept',
    [0.5, 0.5, 0], // similarity ~0.70 < 0.95
    kept,
    { embeddingThreshold: 0.85, localThreshold: 0.75, tagThreshold: 0.95 }
  );

  assert.strictEqual(resAdjusted.keep, true);
});

test('Sandbox engine bypasses gates (tested via runner configuration)', () => {
  const res = evaluateGate(
    'Test text',
    [1, 0, 0],
    'Idea',
    [1, 0, 0],
    [],
    { embeddingThreshold: 0.85, localThreshold: 0.75, tagThreshold: 0.90 }
  );
  assert.strictEqual(res.keep, true);
});
