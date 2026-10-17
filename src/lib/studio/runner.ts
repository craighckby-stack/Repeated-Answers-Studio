/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AnswerEntry, StudioSettings } from './types';
import { checkModel, generateAnswer, getEmbedding, llmNoveltyJudge } from './gemini';
import { judgeNovelty, normalizeVector, contentWords } from './novelty';
import { generateSandboxAnswer, getSandboxCapacity } from './sandbox';
import { commitBatchToGitHub, validateRepoFormat } from './github';
import { saveRunArchive } from './storage';

export interface RunnerCallbacks {
  onStateUpdate: (state: {
    status: 'idle' | 'running' | 'paused' | 'completed' | 'stopped' | 'rate_limited';
    keptCount: number;
    rejectedCount: number;
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
    this.callbacks.onStateUpdate({
      status: this.status,
      keptCount: this.keptEntries.length,
      rejectedCount: this.attemptIndex - this.keptEntries.length,
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
        let modelUsed: string | undefined = undefined;

        if (this.settings.engine === 'sandbox') {
          const cap = getSandboxCapacity();
          if (currentAttempt > cap) {
            this.status = 'completed';
            this.notify('Sandbox engine reached maximum distinct answers capacity.');
            break;
          }
          text = generateSandboxAnswer(currentAttempt - 1);
          modelUsed = 'sandbox';
          await new Promise(r => setTimeout(r, 50)); // simulate brief tick
        } else {
          // Gemini generation with backoff
          const genResult = await this.generateWithBackoff();
          text = genResult.text;
          modelUsed = genResult.modelUsed;
        }

        if (!text || text.trim() === '') {
          this.consecutiveMisses++;
          continue;
        }

        // Fix 1: When engine is "sandbox", do not compute fake embedding. Pass empty embedding [] so judgeNovelty uses only word overlap.
        let embedding: number[] = [];
        if (this.settings.engine === 'gemini') {
          try {
            const rawEmb = await getEmbedding(text);
            embedding = normalizeVector(rawEmb);
          } catch (e) {
            console.warn('Embedding generation warning:', e);
          }
        }

        const wordSet = Array.from(contentWords(text));

        // 1. Judge novelty against kept entries (Embedding + Jaccard)
        const judge = judgeNovelty(
          text,
          embedding,
          this.keptEntries,
          this.settings.embeddingThreshold,
          this.settings.localThreshold
        );

        let isNovel = judge.isNovel;
        let reason = judge.reason;
        let similarityScore = judge.similarityScore;

        // 2. Final LLM-as-judge validation step if basic filter passed and useLlmJudge is enabled
        if (isNovel && this.settings.useLlmJudge && this.keptEntries.length > 0 && this.settings.engine === 'gemini') {
          const closest = this.keptEntries.slice(-5).map(e => e.text);
          const llmResult = await llmNoveltyJudge(text, closest, this.settings.model);
          if (!llmResult.isNovel) {
            isNovel = false;
            reason = `LLM Judge: ${llmResult.reason}`;
          }
        }

        const entry: AnswerEntry = {
          id: `${this.runId}-${currentAttempt}`,
          runId: this.runId,
          index: currentAttempt,
          text,
          timestamp: Date.now(),
          embedding,
          wordSet,
          status: isNovel ? 'kept' : 'rejected',
          reason,
          similarityScore,
          closestMatchId: judge.closestMatchId,
          closestMatchText: judge.closestMatchText,
          modelUsed,
        };

        this.entries.push(entry);

        if (isNovel) {
          this.keptEntries.push(entry);
          this.batchBuffer.push(entry);
          this.consecutiveMisses = 0;

          if (this.batchBuffer.length >= this.settings.perCommit) {
            await this.flushBatch(false);
          }
        } else {
          this.consecutiveMisses++;
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
          this.notify(err.message || 'Error in run iteration');
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
  }

  private async generateWithBackoff(): Promise<{ text: string; modelUsed?: string }> {
    let delay = 2000;
    let totalElapsed = 0;
    const maxElapsed = 15000; // 15 seconds max backoff for transient issues

    while (totalElapsed < maxElapsed) {
      try {
        const recentTexts = this.keptEntries.slice(-15).map(e => e.text);
        const result = await generateAnswer(
          this.settings.model,
          this.settings.question,
          this.settings.shape,
          recentTexts,
          this.settings.highThinking
        );
        return { text: result.text, modelUsed: result.modelUsed };
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
