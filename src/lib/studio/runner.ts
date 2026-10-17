/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AnswerEntry, StudioSettings } from './types';
import { checkModel, generateAnswer, getEmbeddings, getEmbedding, llmNoveltyJudge } from './gemini';
import { judgeNovelty, normalizeVector, contentWords, cosineSimilarity, jaccardSimilarity } from './novelty';
import { generateSandboxAnswer, getSandboxCapacity } from './sandbox';
import { commitBatchToGitHub, validateRepoFormat } from './github';
import { saveRunArchive } from './storage';

export interface RunnerCallbacks {
  onStateUpdate: (state: {
    status: 'idle' | 'running' | 'paused' | 'completed' | 'stopped' | 'rate_limited';
    keptCount: number;
    rejectedCount: number;
    errorCount: number;
    consecutiveMisses: number;
    entries: AnswerEntry[];
    error?: string;
    commitStatus: 'idle' | 'committing' | 'success' | 'failed';
    commitError?: string;
  }) => void;
  onEntryAdded: (entry: AnswerEntry) => void;
}

export class StudioRunner {
  private settings: StudioSettings;
  private status: 'idle' | 'running' | 'paused' | 'completed' | 'stopped' | 'rate_limited' = 'idle';
  private entries: AnswerEntry[] = [];
  private keptEntries: AnswerEntry[] = [];
  private runId: string = '';
  private attemptIndex = 0;
  private consecutiveMisses = 0;
  private callbacks: RunnerCallbacks;
  private batchBuffer: AnswerEntry[] = [];
  private currentBatchIndex = 1;
  private commitStatus: 'idle' | 'committing' | 'success' | 'failed' = 'idle';
  private commitError?: string;

  constructor(settings: StudioSettings, callbacks: RunnerCallbacks) {
    this.settings = settings;
    this.callbacks = callbacks;
  }

  public updateSettings(newSettings: StudioSettings) {
    this.settings = newSettings;
  }

  public async start() {
    this.runId = 'run-' + Math.random().toString(36).substring(2, 9);
    this.attemptIndex = 0;
    this.consecutiveMisses = 0;
    this.entries = [];
    this.keptEntries = [];
    this.batchBuffer = [];
    this.currentBatchIndex = 1;
    this.status = 'running';
    this.commitStatus = 'idle';

    this.notify();

    // 1. Model check if using Gemini engine
    if (this.settings.engine === 'gemini') {
      const check = await checkModel(this.settings.model);
      if (!check.success) {
        this.status = 'stopped';
        const errMsg = check.error?.includes('404') || check.error?.includes('not found')
          ? 'Model not found. Check the name.'
          : (check.error || 'Model validation failed');
        this.notify(errMsg);
        return;
      }
    }

    this.loop();
  }

  public pause() {
    if (this.status === 'running' || this.status === 'rate_limited') {
      this.status = 'paused';
      this.notify();
    }
  }

  public resume() {
    if (this.status === 'paused' || this.status === 'rate_limited') {
      this.status = 'running';
      this.notify();
      this.loop();
    }
  }

  public stop() {
    this.status = 'stopped';
    this.notify();
    this.archiveCurrentRun();
  }

  private notify(error?: string) {
    const errorCount = this.entries.filter(e => e.status === 'error').length;
    const rejectedCount = this.entries.filter(e => e.status === 'rejected').length;
    this.callbacks.onStateUpdate({
      status: this.status,
      keptCount: this.keptEntries.length,
      rejectedCount,
      errorCount,
      consecutiveMisses: this.consecutiveMisses,
      entries: [...this.entries],
      error,
      commitStatus: this.commitStatus,
      commitError: this.commitError,
    });
  }

  private async loop() {
    while (this.status === 'running') {
      if (this.keptEntries.length >= this.settings.target) {
        this.status = 'completed';
        this.notify();
        await this.flushBatch(true);
        this.archiveCurrentRun();
        break;
      }

      if (this.consecutiveMisses >= this.settings.maxMisses) {
        this.status = 'paused';
        this.notify('Paused: Reached maximum consecutive rejections. Adjust thresholds or prompt.');
        break;
      }

      this.attemptIndex++;
      const currentAttempt = this.attemptIndex;

      try {
        let text = '';
        let coreIdea: string | null = null;
        let modelUsed: string | undefined = undefined;
        let fallbackUsed: boolean | undefined = undefined;

        if (this.settings.engine === 'sandbox') {
          const cap = getSandboxCapacity();
          if (currentAttempt > cap) {
            this.status = 'completed';
            this.notify('Sandbox engine reached maximum distinct answers capacity.');
            break;
          }
          const sandboxRes = generateSandboxAnswer(currentAttempt - 1);
          text = sandboxRes.text;
          coreIdea = sandboxRes.coreIdea;
          modelUsed = 'sandbox';
          await new Promise(r => setTimeout(r, 50)); // simulate brief tick
        } else {
          const recentIdeas = this.keptEntries
            .map(e => e.coreIdea)
            .filter((i): i is string => Boolean(i))
            .slice(-30);

          const genResult = await this.generateWithBackoff(recentIdeas);
          text = genResult.text;
          coreIdea = genResult.coreIdea;
          modelUsed = genResult.modelUsed;
          fallbackUsed = genResult.fallbackUsed;
        }

        if (!text || text.trim() === '') {
          this.consecutiveMisses++;
          const errEntry: AnswerEntry = {
            id: `${this.runId}-${currentAttempt}`,
            runId: this.runId,
            index: currentAttempt,
            text: '',
            timestamp: Date.now(),
            status: 'error',
            reason: 'Empty model output',
            selectedModel: this.settings.model,
            modelUsed,
          };
          this.entries.push(errEntry);
          this.batchBuffer.push(errEntry);
          if (this.batchBuffer.length >= this.settings.perCommit) {
            await this.flushBatch(false);
          }
          this.notify();
          continue;
        }

        const evaluated = await this.evaluateCandidate(text, { coreIdea });

        const isNovel = evaluated.keep;
        const reason = evaluated.reason;
        const similarityScore = evaluated.similarityScore;

        let embedding: number[] = [];
        if (this.settings.engine === 'gemini') {
          try {
            embedding = await getEmbedding(text);
          } catch (e) {
            console.warn('Embedding generation warning:', e);
          }
        }
        const wordSet = Array.from(contentWords(text));
        const resolvedCoreIdea = coreIdea || text.slice(0, 160);

        const entry: AnswerEntry = {
          id: `${this.runId}-${currentAttempt}`,
          runId: this.runId,
          index: currentAttempt,
          text,
          timestamp: Date.now(),
          embedding,
          wordSet,
          status: isNovel ? 'kept' : 'rejected',
          coreIdea: resolvedCoreIdea,
          reason,
          similarityScore,
          closestMatchId: evaluated.closestMatchId,
          closestMatchText: evaluated.closestMatchText,
          selectedModel: this.settings.model,
          modelUsed,
          fallbackUsed,
        };

        this.entries.push(entry);
        this.batchBuffer.push(entry); // Change 3: GitHub batch buffer receives every attempt (kept, rejected, error)

        if (isNovel) {
          this.keptEntries.push(entry);
          this.consecutiveMisses = 0;
        } else {
          this.consecutiveMisses++;
        }

        if (this.batchBuffer.length >= this.settings.perCommit) {
          await this.flushBatch(false);
        }

        this.callbacks.onEntryAdded(entry);
        this.notify();

      } catch (err: any) {
        console.error('Run iteration error:', err);
        const status = err.status || err.code || 500;
        if (
          status === 429 ||
          status === 503 ||
          err.message?.includes('429') ||
          err.message?.includes('RESOURCE_EXHAUSTED') ||
          err.message?.includes('Daily') ||
          err.message?.includes('quota') ||
          err.message?.includes('Failed to fetch')
        ) {
          this.status = 'rate_limited';
          const msg = err.message?.includes('Daily') || err.message?.includes('quota') || err.message?.includes('429')
            ? 'Free tier daily/rate quota reached. Switch to Sandbox Engine to continue instantly without limits.'
            : 'Network connection issue (Failed to fetch). Switch to Sandbox Engine or retry when ready.';
          this.notify(msg);
          break;
        } else {
          this.consecutiveMisses++;
          const errEntry: AnswerEntry = {
            id: `${this.runId}-${currentAttempt}`,
            runId: this.runId,
            index: currentAttempt,
            text: '',
            timestamp: Date.now(),
            status: 'error',
            reason: err.message || 'Error in run iteration',
            selectedModel: this.settings.model,
          };
          this.entries.push(errEntry);
          this.batchBuffer.push(errEntry);
          if (this.batchBuffer.length >= this.settings.perCommit) {
            await this.flushBatch(false);
          }
          this.notify(err.message || 'Error in run iteration');
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
  }

  private async generateWithBackoff(recentIdeas: string[]): Promise<{ text: string; coreIdea: string; modelUsed?: string; fallbackUsed?: boolean }> {
    let delay = 2000;
    let totalElapsed = 0;
    const maxElapsed = 15000;

    while (totalElapsed < maxElapsed) {
      try {
        const recentTexts = this.keptEntries.slice(-15).map(e => e.text);
        const result = await generateAnswer(
          this.settings.model,
          this.settings.question,
          this.settings.shape,
          recentTexts,
          recentIdeas,
          this.settings.highThinking
        );
        return { text: result.text, coreIdea: result.coreIdea, modelUsed: result.modelUsed, fallbackUsed: result.fallbackUsed };
      } catch (err: any) {
        const status = err.status || err.code || 500;
        if (
          err.message?.includes('GenerateRequestsPerDay') ||
          err.message?.includes('13h') ||
          err.message?.includes('daily quota')
        ) {
          throw new Error('Daily free tier quota exceeded (20/day limit). Switch to Sandbox Engine to continue.');
        }
        if (status === 429 || status === 503 || err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
          totalElapsed += delay;
          if (totalElapsed >= maxElapsed) {
            throw err;
          }
          await new Promise(r => setTimeout(r, delay));
          delay *= 2;
        } else {
          throw err;
        }
      }
    }
    throw new Error('Rate limit retries exceeded.');
  }

  private async flushBatch(isFinal: boolean) {
    if (this.batchBuffer.length === 0) return;
    if (!this.settings.ghToken || !validateRepoFormat(this.settings.ghOwnerRepo)) {
      this.batchBuffer = [];
      return;
    }

    const batchToCommit = [...this.batchBuffer];
    this.batchBuffer = [];
    this.commitStatus = 'committing';
    this.notify();

    const res = await commitBatchToGitHub(
      this.settings.ghToken,
      this.settings.ghOwnerRepo,
      this.settings.ghBranch,
      this.runId,
      this.currentBatchIndex,
      batchToCommit
    );

    if (res.success) {
      this.commitStatus = 'success';
      this.currentBatchIndex++;
      this.notify();
    } else {
      this.commitStatus = 'failed';
      this.commitError = res.error;
      this.batchBuffer = [...batchToCommit, ...this.batchBuffer];
      this.notify(res.error);
    }
  }

  private async evaluateCandidate(
    text: string,
    structured?: { core_claim?: string; coreIdea?: string } | null
  ): Promise<{
    keep: boolean;
    reason?: string;
    similarityScore?: number;
    closestMatchId?: string;
    closestMatchText?: string;
    coreSimilarity?: number;
    tagSimilarity?: number;
  }> {
    const newCore =
      structured?.core_claim ||
      structured?.coreIdea ||
      text.slice(0, 180);

    const embedding = this.settings.engine === 'sandbox' ? [] : await getEmbedding(text);
    const emb = normalizeVector(embedding);
    const newWords = contentWords(text);

    let maxEmbSim = 0;
    let maxLocSim = 0;
    let closest: AnswerEntry | null = null;

    for (const kept of this.keptEntries) {
      if (kept.embedding?.length && emb.length) {
        const sim = cosineSimilarity(emb, kept.embedding);
        if (sim > maxEmbSim) {
          maxEmbSim = sim;
          closest = kept;
        }
      }
      if (kept.wordSet) {
        const loc = jaccardSimilarity(newWords, new Set(kept.wordSet));
        if (loc > maxLocSim) maxLocSim = loc;
      }
    }

    const EMB_THRESHOLD = this.settings.embeddingThreshold ?? 0.88;
    const LOC_THRESHOLD = this.settings.localThreshold ?? 0.72;

    if (this.settings.engine !== 'sandbox') {
      if (maxEmbSim >= EMB_THRESHOLD) {
        return {
          keep: false,
          reason: `Full-text too similar (${(maxEmbSim * 100).toFixed(1)}% ≥ ${(EMB_THRESHOLD * 100).toFixed(0)}%)`,
          similarityScore: maxEmbSim,
          closestMatchId: closest?.id,
          closestMatchText: closest?.text,
        };
      }

      if (maxLocSim >= LOC_THRESHOLD) {
        return {
          keep: false,
          reason: `Wording overlap too high (${(maxLocSim * 100).toFixed(1)}%)`,
          similarityScore: maxLocSim,
          closestMatchId: closest?.id,
          closestMatchText: closest?.text,
        };
      }

      // Core-idea embedding filter (PRIMARY conceptual gate)
      const CORE_THRESHOLD = 0.82;
      if (this.keptEntries.length > 0) {
        const newCoreEmb = normalizeVector(await getEmbedding(newCore));
        let maxCoreSim = 0;
        let closestCore: AnswerEntry | null = null;

        for (const kept of this.keptEntries) {
          const keptCore = kept.coreIdea || kept.text.slice(0, 180);
          const keptCoreEmb = normalizeVector(await getEmbedding(keptCore));
          const sim = cosineSimilarity(newCoreEmb, keptCoreEmb);

          if (sim > maxCoreSim) {
            maxCoreSim = sim;
            closestCore = kept;
          }
        }

        if (maxCoreSim >= CORE_THRESHOLD) {
          return {
            keep: false,
            reason: `Core idea too similar to previous (${(maxCoreSim * 100).toFixed(1)}%): "${closestCore?.coreIdea || closestCore?.text.slice(0, 80)}..."`,
            similarityScore: maxCoreSim,
            coreSimilarity: maxCoreSim,
            closestMatchId: closestCore?.id,
            closestMatchText: closestCore?.text,
          };
        }
      }

      // LLM conceptual novelty judge
      if (this.settings.useLlmJudge !== false && this.keptEntries.length > 0) {
        const keptCores = this.keptEntries
          .slice(-8)
          .map(e => e.coreIdea || e.text.slice(0, 120));

        const judge = await llmNoveltyJudge(text, keptCores, newCore, this.settings.model);
        if (!judge.isNovel) {
          return {
            keep: false,
            reason: `LLM conceptual judge: ${judge.reason}`,
          };
        }
      }
    }

    return {
      keep: true,
      similarityScore: maxEmbSim,
      coreSimilarity: 0,
    };
  }

  private archiveCurrentRun() {
    saveRunArchive(this.runId, this.entries, {
      question: this.settings.question,
      keptCount: this.keptEntries.length,
      totalAttempts: this.attemptIndex,
    });
  }

  public async retryCommit() {
    if (this.commitStatus === 'failed') {
      await this.flushBatch(false);
    }
  }
}
