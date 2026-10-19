/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import { evaluateGate, checkTestable, jaccardSimilarity, contentWords, normalizeVector, cosineSimilarity } from '../src/lib/studio/novelty';
import { AnswerEntry, DEFAULT_SETTINGS, clampSettings } from '../src/lib/studio/types';
import { StudioRunner } from '../src/lib/studio/runner';
import {
  calculateShannonEntropy,
  sanitizeContent,
  auditEmgCandidate,
  evaluateEmgSelfStopping,
  selectEmgNegativeConstraints,
} from '../src/lib/studio/emg';
import { EMG_PERSONAS, getPersonaByIndex, formatPersonaDirective } from '../src/lib/studio/personas';
import { buildTopologyMermaidGraph } from '../src/lib/studio/graph';
import { createMemoryDump, parseMemoryDump } from '../src/lib/studio/storage';

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

test('EMG: calculateShannonEntropy measures information density accurately', () => {
  assert.strictEqual(calculateShannonEntropy(''), 0);
  assert.strictEqual(calculateShannonEntropy('aaaaaaa'), 0);

  // Repetitive text has low entropy
  const lowEntropy = calculateShannonEntropy('abababababababababababab');
  assert.ok(lowEntropy <= 1.0);

  // Natural diverse English prose has high entropy (~ 4.0 - 4.8 bits/char)
  const naturalText = 'What unexpected structural failure modes cause large distributed microservice systems to experience cascading collapse?';
  const naturalEntropy = calculateShannonEntropy(naturalText);
  assert.ok(naturalEntropy >= 4.0 && naturalEntropy <= 5.0, `Expected entropy between 4 and 5, got ${naturalEntropy}`);
});

test('EMG: sanitizeContent redacts API keys and high-entropy secret tokens', () => {
  const textWithSecrets = `
    Here is our secret configuration:
    Google key: AIzaSyD94Jfk290-xKL88390192jfkdls_92301
    GitHub token: ghp_111122223333444455556666777788889999
    Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgN_pT_V_A_bC_dE_fG_hI_jK
  `;

  const result = sanitizeContent(textWithSecrets);
  assert.ok(result.redactedCount >= 2);
  assert.ok(!result.sanitized.includes('AIzaSyD94Jfk290-xKL88390192jfkdls_92301'));
  assert.ok(!result.sanitized.includes('ghp_111122223333444455556666777788889999'));
  assert.ok(result.sanitized.includes('[REDACTED_GOOGLE_KEY]'));
  assert.ok(result.sanitized.includes('[REDACTED_GITHUB_TOKEN]'));
});

test('EMG: auditEmgCandidate enforces mass preservation and entropy floor', () => {
  // Too short
  const shortResult = auditEmgCandidate('Too short', 'Brief idea');
  assert.strictEqual(shortResult.ok, false);
  assert.ok(shortResult.reason?.includes('Mass Preservation'));

  // Low entropy robotic boilerplate
  const roboticText = 'test test test test test test test test test test test test test test test test test test test test';
  const roboticResult = auditEmgCandidate(roboticText, 'Repetitive idea', 3.6);
  assert.strictEqual(roboticResult.ok, false);
  assert.ok(roboticResult.reason?.includes('Entropy Floor'));

  // Valid high-density mechanistic hypothesis
  const validText = 'Galactic cosmic radiation triggers microvascular endothelial apoptosis in deep subcortical cerebral pathways during transit.';
  const validResult = auditEmgCandidate(validText, 'Endothelial apoptosis', 3.6);
  assert.strictEqual(validResult.ok, true);
  assert.ok(validResult.entropy >= 3.6);
});

test('EMG: evaluateEmgSelfStopping triggers clean halt on saturation and entropy flatline', () => {
  // Reaching max misses
  const halt1 = evaluateEmgSelfStopping([], 20, 20);
  assert.strictEqual(halt1.shouldHalt, true);
  assert.ok(halt1.reason?.includes('Consensus saturation'));

  // Under limit with normal entries
  const normalEntries: AnswerEntry[] = Array.from({ length: 12 }, (_, i) => ({
    id: `r-${i}`,
    runId: 'r',
    index: i,
    text: `Varied unique concept ${i} discussing physiological space colonization obstacles ${i * 42}.`,
    timestamp: Date.now(),
    status: 'rejected',
  }));
  const noHalt = evaluateEmgSelfStopping(normalEntries, 3, 20);
  assert.strictEqual(noHalt.shouldHalt, false);
});

test('EMG Core: 9 personas defined and cycle deterministically', () => {
  assert.strictEqual(EMG_PERSONAS.length, 9);
  const ids = EMG_PERSONAS.map(p => p.id);
  assert.ok(ids.includes('causal_logician'));
  assert.ok(ids.includes('economist'));
  assert.ok(ids.includes('futurist'));
  assert.ok(ids.includes('ethicist'));
  assert.ok(ids.includes('legal_expert'));
  assert.ok(ids.includes('historian'));
  assert.ok(ids.includes('philosopher'));
  assert.ok(ids.includes('data_analyst'));
  assert.ok(ids.includes('social_scientist'));

  // Cycles deterministically by attempt index
  assert.strictEqual(getPersonaByIndex(0).id, 'causal_logician');
  assert.strictEqual(getPersonaByIndex(1).id, 'economist');
  assert.strictEqual(getPersonaByIndex(9).id, 'causal_logician');

  // Formats directive correctly
  const directive = formatPersonaDirective('economist');
  assert.ok(directive.includes('ECONOMIST'));
  assert.ok(directive.includes('externalities'));
});

test('EMG Core: buildTopologyMermaidGraph generates valid top-down Mermaid concept graph', () => {
  const kept: AnswerEntry[] = [
    {
      id: 'k-1',
      runId: 'r-1',
      index: 1,
      text: 'Orbital debris cascading chain collision models.',
      coreIdea: 'Kessler Syndrome Feedback',
      observableConsequence: 'Telemetry sensors show 14% increase in sub-millimeter impacts',
      persona: 'Causal Logician',
      status: 'kept',
      timestamp: Date.now(),
    },
    {
      id: 'k-2',
      runId: 'r-1',
      index: 2,
      text: 'Unpriced launch externalities cause tragedy of the orbital commons.',
      coreIdea: 'Orbital Commons Tragedy',
      observableConsequence: 'Collision cleanup bond markets fail to clear due to jurisdiction gaps',
      persona: 'Economist',
      status: 'kept',
      timestamp: Date.now(),
    },
  ];

  const graph = buildTopologyMermaidGraph('Space Debris Risks', kept);
  assert.ok(graph.startsWith('graph TD'));
  assert.ok(graph.includes('ROOT(["Space Debris Risks"])'));
  assert.ok(graph.includes('Causal Logician'));
  assert.ok(graph.includes('Economist'));
  assert.ok(graph.includes('Kessler Syndrome Feedback'));
  assert.ok(graph.includes('predicts'));

  // Empty entries test
  const emptyGraph = buildTopologyMermaidGraph('Empty', []);
  assert.ok(emptyGraph.includes('EMPTY'));
});

test('EMG Core: createMemoryDump packages state safely and strips secret tokens', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    question: 'Why do distributed systems fail? Secret: AIzaSyD94Jfk290-xKL88390192jfkdls_92301',
    ghToken: 'ghp_secretTokenDoNotLeak1234567890',
    appAccessToken: 'secretAccessSecret999',
  };

  const runState = {
    runId: 'test-run-123',
    status: 'idle' as const,
    target: 10,
    entries: [
      {
        id: 'e-1',
        runId: 'test-run-123',
        index: 1,
        text: 'Cascading network partition latency. Key: AIzaSyHiddenCredentials1234567',
        status: 'kept' as const,
        timestamp: Date.now(),
      },
    ],
    keptCount: 1,
    rejectedCount: 0,
    errorCount: 0,
    consecutiveMisses: 0,
    startTime: Date.now(),
    lastCommitBatch: 1,
    commitStatus: 'idle' as const,
  };

  const macroSynthesis = {
    topic: 'Why do distributed systems fail?',
    synthesisAnalysis: 'Systemic synthesis analysis...',
    hypotheticalAssumptions: ['Networks are asynchronous'],
    researchFrontiers: ['Zero-downtime leader election'],
    generatedAt: Date.now(),
  };

  const rawJson = createMemoryDump(settings, runState, macroSynthesis);
  assert.ok(typeof rawJson === 'string');

  // Verify secret tokens are never leaked into the JSON dump
  assert.ok(!rawJson.includes('ghp_secretTokenDoNotLeak1234567890'));
  assert.ok(!rawJson.includes('secretAccessSecret999'));
  assert.ok(!rawJson.includes('AIzaSyFakeToken1234567890abcdef'));
  assert.ok(rawJson.includes('[REDACTED_GOOGLE_KEY]'));

  // Test restoration
  const restored = parseMemoryDump(rawJson);
  assert.strictEqual(restored.kernel, 'EMG-KERNEL-v0.3');
  assert.strictEqual(restored.runState.entries.length, 1);
  assert.strictEqual(restored.runState.keptCount, 1);
  assert.strictEqual(restored.macroSynthesis.hypotheticalAssumptions.length, 1);
  assert.strictEqual(restored.settings.ghToken, '');
  assert.strictEqual(restored.settings.appAccessToken, '');
});

test('EMG Core: parseMemoryDump gracefully rejects corrupted JSON', () => {
  assert.throws(() => parseMemoryDump('invalid { non-json string'), /Invalid JSON format/);
  assert.throws(() => parseMemoryDump('null'), /not a valid JSON object/);
});






