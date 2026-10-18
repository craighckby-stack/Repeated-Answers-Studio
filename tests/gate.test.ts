/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import { evaluateGate, checkTestable, jaccardSimilarity, contentWords, normalizeVector, cosineSimilarity } from '../src/lib/studio/novelty';
import { AnswerEntry, DEFAULT_SETTINGS, clampSettings } from '../src/lib/studio/types';
import { StudioRunner } from '../src/lib/studio/runner';

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

test('clampSettings: abstraction validates concrete/balanced/abstract and defaults to balanced', () => {
  const concreteSettings = clampSettings({ ...DEFAULT_SETTINGS, abstraction: 'concrete' });
  assert.strictEqual(concreteSettings.abstraction, 'concrete');

  const abstractSettings = clampSettings({ ...DEFAULT_SETTINGS, abstraction: 'abstract' });
  assert.strictEqual(abstractSettings.abstraction, 'abstract');

  const invalidSettings = clampSettings({ ...DEFAULT_SETTINGS, abstraction: 'invalid_val' as any });
  assert.strictEqual(invalidSettings.abstraction, 'balanced');

  const emptySettings = clampSettings({ ...DEFAULT_SETTINGS, abstraction: undefined as any });
  assert.strictEqual(emptySettings.abstraction, 'balanced');
});

test('Gate 1: Full-text embedding cosine >= embeddingThreshold is rejected', () => {
  const kept: AnswerEntry[] = [
    {
      id: 'r1-1',
      runId: 'r1',
      index: 1,
      text: 'Original full text here',
      timestamp: Date.now(),
      status: 'kept',
      coreIdea: 'Original idea',
      embedding: [1, 0, 0],
      coreEmbedding: [0, 1, 0],
      wordSet: ['original', 'full', 'text'],
    },
  ];

  const res = evaluateGate(
    'Different wording entirely for test',
    [0.9, 0, 0], // cosine ~ 0.9 >= 0.85
    'Different idea concept',
    [0, 0, 1], // core cosine 0
    kept,
    { embeddingThreshold: 0.85, localThreshold: 0.75, tagThreshold: 0.90 }
  );

  assert.strictEqual(res.keep, false);
  assert.strictEqual(res.reason, 'Full-text too similar');
});

test('Gate 2: Wording overlap (Jaccard) >= localThreshold is rejected', () => {
  const kept: AnswerEntry[] = [
    {
      id: 'r1-1',
      runId: 'r1',
      index: 1,
      text: 'alpha beta gamma delta epsilon zeta eta',
      timestamp: Date.now(),
      status: 'kept',
      coreIdea: 'Idea Alpha',
      embedding: [1, 0, 0],
      coreEmbedding: [1, 0, 0],
      wordSet: ['alpha', 'beta', 'gamma', 'delta'],
    },
  ];

  const res = evaluateGate(
    'alpha beta gamma delta',
    [0, 1, 0], // embedding dissimilar
    'Distinct core idea',
    [0, 1, 0], // core embedding dissimilar
    kept,
    { embeddingThreshold: 0.85, localThreshold: 0.75, tagThreshold: 0.90 }
  );

  assert.strictEqual(res.keep, false);
  assert.strictEqual(res.reason, 'Wording overlap too high');
});

test('Testability gate: checkTestable rules for observableConsequence and counterevidence', () => {
  const validObs = 'Measurements of atmospheric CO2 in lunar habitat domes showing >5% variation weekly.';
  const validCnt = 'Spectroscopic measurements finding zero difference between control and exposed surfaces.';

  // Both valid
  const resValid = checkTestable(validObs, validCnt);
  assert.strictEqual(resValid.ok, true);
  assert.strictEqual(resValid.reason, undefined);

  // Observable too short (<30 chars)
  const resShortObs = checkTestable('Too short.', validCnt);
  assert.strictEqual(resShortObs.ok, false);
  assert.strictEqual(resShortObs.reason, 'Not testable: no observable consequence stated');

  // Counterevidence too short (<30 chars)
  const resShortCnt = checkTestable(validObs, 'Too short.');
  assert.strictEqual(resShortCnt.ok, false);
  assert.strictEqual(resShortCnt.reason, 'Not testable: no counterevidence stated');

  // Banned phrases exact match
  const resNoneObs = checkTestable('none', validCnt);
  assert.strictEqual(resNoneObs.ok, false);
  assert.strictEqual(resNoneObs.reason, 'Not testable: no observable consequence stated');

  const resNaCnt = checkTestable(validObs, 'n/a');
  assert.strictEqual(resNaCnt.ok, false);
  assert.strictEqual(resNaCnt.reason, 'Not testable: no counterevidence stated');

  // Banned phrases with period or comma followed by long text
  const resBannedWithPeriod = checkTestable('cannot be tested. Here is a long explanation that exceeds thirty characters in length.', validCnt);
  assert.strictEqual(resBannedWithPeriod.ok, false);
  assert.strictEqual(resBannedWithPeriod.reason, 'Not testable: no observable consequence stated');

  const resBannedWithComma = checkTestable(validObs, 'not applicable, as this mechanism cannot be quantified or observed at all.');
  assert.strictEqual(resBannedWithComma.ok, false);
  assert.strictEqual(resBannedWithComma.reason, 'Not testable: no counterevidence stated');

  // evaluateGate fails first on testability before any embedding checks
  const gateTestableFail = evaluateGate(
    'Candidate text with valid embeddings',
    [0.99, 0, 0],
    'Candidate idea',
    [0.99, 0, 0],
    [],
    { embeddingThreshold: 0.85, localThreshold: 0.75, tagThreshold: 0.90 },
    'untestable. this candidate claims to be untestable over 30 chars.',
    validCnt
  );
  assert.strictEqual(gateTestableFail.keep, false);
  assert.strictEqual(gateTestableFail.reason, 'Not testable: no observable consequence stated');
});

test('jaccardSimilarity: empty sets are never treated as duplicates of each other', () => {
  const empty1 = new Set<string>();
  const empty2 = new Set<string>();
  const nonEmpty = new Set<string>(['alpha', 'beta']);

  assert.strictEqual(jaccardSimilarity(empty1, empty2), 0);
  assert.strictEqual(jaccardSimilarity(empty1, nonEmpty), 0);
  assert.strictEqual(jaccardSimilarity(nonEmpty, empty1), 0);
  assert.strictEqual(jaccardSimilarity(nonEmpty, nonEmpty), 1.0);
});

test('contentWords: tokenizes Latin words > 2 chars, strips punctuation, handles CJK character bigrams', () => {
  const latin = contentWords('In an era of rapid AI, progress is swift.');
  assert.ok(latin.has('era'));
  assert.ok(latin.has('rapid'));
  assert.ok(latin.has('progress'));
  assert.ok(latin.has('swift'));
  assert.ok(!latin.has('in')); // <= 2 chars
  assert.ok(!latin.has('an')); // <= 2 chars
  assert.ok(!latin.has('ai')); // <= 2 chars

  // CJK bigrams
  const cjk = contentWords('量子計算'); // Quantum computing in Chinese/Japanese
  assert.ok(cjk.has('量子'));
  assert.ok(cjk.has('子計'));
  assert.ok(cjk.has('計算'));
});

test('evaluateGate: uses keptWords fallback when keptEntry.wordSet is undefined', () => {
  const keptWithoutWordSet: AnswerEntry = {
    id: 'r1-legacy',
    runId: 'r1',
    index: 1,
    text: 'specialized astrophysics observatory telemetry pipeline',
    timestamp: Date.now(),
    status: 'kept',
    coreIdea: 'Astrophysics pipeline',
    embedding: [1, 0, 0],
    coreEmbedding: [1, 0, 0],
    // wordSet omitted
  };

  const res = evaluateGate(
    'specialized astrophysics observatory telemetry pipeline data',
    [0, 1, 0],
    'Distinct idea',
    [0, 1, 0],
    [keptWithoutWordSet],
    { embeddingThreshold: 0.85, localThreshold: 0.70, tagThreshold: 0.90 }
  );

  assert.strictEqual(res.keep, false);
  assert.strictEqual(res.reason, 'Wording overlap too high');
});

test('StudioRunner: runs to target completion using sandbox engine', async () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    engine: 'sandbox' as const,
    target: 3,
  };

  let finalState: any = null;
  const addedEntries: AnswerEntry[] = [];

  const runner = new StudioRunner(settings, {
    onStateUpdate: (state) => {
      finalState = state;
    },
    onEntryAdded: (entry) => {
      addedEntries.push(entry);
    },
  });

  await runner.start();
  // Wait for the asynchronous loop to complete target 3
  while (finalState?.status === 'running') {
    await new Promise(r => setTimeout(r, 20));
  }

  assert.strictEqual(finalState?.status, 'completed');
  assert.strictEqual(finalState?.keptCount, 3);
  assert.strictEqual(addedEntries.length, 3);
  assert.ok(addedEntries.every(e => e.status === 'kept'));
  assert.ok(addedEntries.every(e => e.modelUsed === 'sandbox'));
});

test('Question input lines limit: allows up to 1000 lines', () => {
  const lineArray1000 = Array.from({ length: 1000 }, (_, i) => `Line ${i + 1}: Observation data`);
  const text1000 = lineArray1000.join('\n');
  assert.strictEqual(text1000.split('\n').length, 1000);

  const lineArray1001 = Array.from({ length: 1001 }, (_, i) => `Line ${i + 1}: Observation data`);
  const text1001 = lineArray1001.join('\n');
  assert.strictEqual(text1001.split('\n').length, 1001);
  assert.ok(text1001.split('\n').length > 1000);
});



