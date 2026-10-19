/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AnswerEntry, StudioSettings } from './types';
import { checkModel, generateAnswer, getEmbeddings, llmNoveltyJudge } from './gemini';
import { evaluateGate, normalizeVector, contentWords, cosineSimilarity, jaccardSimilarity, checkTestable } from './novelty';
import { generateSandboxAnswer, getSandboxCapacity } from './sandbox';
import { commitBatchToGitHub, validateRepoFormat } from './github';
import { saveRunArchive } from './storage';
import {
  calculateShannonEntropy,
  sanitizeContent,
  auditEmgCandidate,
  evaluateEmgSelfStopping,
  selectEmgNegativeConstraints,
} from './emg';
import { getPersonaByIndex, getPersonaById } from './personas';

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
  private loopRunning = false;
  private consecutiveUnavailableJudge = 0;

  constructor(settings: StudioSettings, callbacks: RunnerCallbacks) {
    this.settings = settings;
    this.callbacks = callbacks;
  }

  public updateSettings(newSettings: StudioSettings) {
    this.settings = newSettings;
  }

  public async start() {
    if (this.loopRunning) return;
    this.runId = 'run-' + Math.random().toString(36).substring(2, 9);
    this.attemptIndex = 0;
    this.consecutiveMisses = 0;
    this.entries = [];
    this.keptEntries = [];
    this.batchBuffer = [];
    this.currentBatchIndex = 1;
    this.status = 'running';
    this.commitStatus = 'idle';
    this.consecutiveUnavailableJudge = 0;

    this.notify();

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
    if ((this.status === 'paused' || this.status === 'rate_limited') && !this.loopRunning) {
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
    if (this.loopRunning) return;
    this.loopRunning = true;

    try {
      while (this.status === 'running') {
        if (this.keptEntries.length >= this.settings.target) {
          this.status = 'completed';
          this.notify();
          await this.flushBatch(true);
          this.archiveCurrentRun();
          break;
        }

        if (this.settings.emgHaltOnDecay) {
          const haltCheck = evaluateEmgSelfStopping(this.entries, this.consecutiveMisses, this.settings.maxMisses);
          if (haltCheck.shouldHalt) {
            this.status = 'paused';
            this.notify(haltCheck.reason);
            break;
          }
        } else if (this.consecutiveMisses >= this.settings.maxMisses) {
          this.status = 'paused';
          this.notify('Paused: Reached maximum consecutive rejections. Adjust thresholds or prompt.');
          break;
        }

        this.attemptIndex++;
        const currentAttempt = this.attemptIndex;

        try {
          let text = '';
          let coreIdea = '';
          let observableConsequence: string | null = null;
          let counterevidence: string | null = null;
          let modelUsed: string | undefined = undefined;
          let fallbackUsed: boolean | undefined = undefined;

          // Determine active EMG persona lens
          let currentPersonaName: string | undefined = undefined;
          if (this.settings.personaMode === 'rotate') {
            currentPersonaName = getPersonaByIndex(currentAttempt - 1).name;
          } else if (this.settings.personaMode && this.settings.personaMode !== 'none') {
            const p = getPersonaById(this.settings.personaMode);
            currentPersonaName = p ? p.name : this.settings.personaMode;
          }

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
            observableConsequence = null;
            counterevidence = null;
            modelUsed = 'sandbox';
            await new Promise(r => setTimeout(r, 50));
          } else {
            // EMG Epistemic Constraint Selector: diverse previous concepts
            const rejectedItems = this.entries.filter(e => e.status === 'rejected');
            const recentIdeas = selectEmgNegativeConstraints(this.keptEntries, rejectedItems, 25);
            const recentTexts = this.keptEntries.slice(-10).map(e => e.text || '');

            const sanitizedQuestion = this.settings.emgSanitizeSecrets
              ? sanitizeContent(this.settings.question).sanitized
              : this.settings.question;

            const genResult = await generateAnswer(
              this.settings.model,
              sanitizedQuestion,
              this.settings.shape,
              recentTexts,
              recentIdeas,
              this.settings.highThinking,
              this.settings.abstraction,
              currentPersonaName
            );
            text = genResult.text;
            coreIdea = genResult.coreIdea || (text ? text.slice(0, 160) : 'General perspective');
            observableConsequence = genResult.observableConsequence || null;
            counterevidence = genResult.counterevidence || null;
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

          // 1. EMG Edge Security Sanitizer: Redact secrets & high-entropy tokens
          let detectedSecrets: string[] = [];
          if (this.settings.emgSanitizeSecrets) {
            const sanText = sanitizeContent(text);
            text = sanText.sanitized;
            detectedSecrets = sanText.detectedSecrets;

            if (coreIdea) {
              coreIdea = sanitizeContent(coreIdea).sanitized;
            }
            if (observableConsequence) {
              observableConsequence = sanitizeContent(observableConsequence).sanitized;
            }
            if (counterevidence) {
              counterevidence = sanitizeContent(counterevidence).sanitized;
            }
          }

          const shannonEntropy = calculateShannonEntropy(text);

          // 2. EMG Mechanistic Density & Information Entropy Audit (gemini only)
          let emgAuditPassed = true;
          if (this.settings.engine === 'gemini' && this.settings.emgGatesEnabled) {
            const emgAudit = auditEmgCandidate(text, coreIdea, this.settings.emgMinEntropy);
            if (!emgAudit.ok) {
              emgAuditPassed = false;
              this.consecutiveMisses++;
              const rejectedEntry: AnswerEntry = {
                id: `${this.runId}-${currentAttempt}`,
                runId: this.runId,
                index: currentAttempt,
                text,
                timestamp: Date.now(),
                status: 'rejected',
                coreIdea,
                observableConsequence,
                counterevidence,
                shannonEntropy,
                sanitizedSecrets: detectedSecrets,
                emgAuditPassed: false,
                reason: emgAudit.reason,
                selectedModel: this.settings.model,
                modelUsed,
                fallbackUsed,
                persona: currentPersonaName,
              };
              this.entries.push(rejectedEntry);
              this.batchBuffer.push(rejectedEntry);
              if (this.batchBuffer.length >= this.settings.perCommit) {
                await this.flushBatch(false);
              }
              this.callbacks.onEntryAdded(rejectedEntry);
              this.notify();
              continue;
            }
          }

          // 3. Testability gate for gemini candidates (sandbox engine bypasses this gate)
          if (this.settings.engine === 'gemini') {
            const testable = checkTestable(observableConsequence, counterevidence);
            if (!testable.ok) {
              this.consecutiveMisses++;
              const rejectedEntry: AnswerEntry = {
                id: `${this.runId}-${currentAttempt}`,
                runId: this.runId,
                index: currentAttempt,
                text,
                timestamp: Date.now(),
                status: 'rejected',
                coreIdea,
                observableConsequence,
                counterevidence,
                shannonEntropy,
                sanitizedSecrets: detectedSecrets,
                emgAuditPassed,
                reason: testable.reason,
                selectedModel: this.settings.model,
                modelUsed,
                fallbackUsed,
                persona: currentPersonaName,
              };
              this.entries.push(rejectedEntry);
              this.batchBuffer.push(rejectedEntry);
              if (this.batchBuffer.length >= this.settings.perCommit) {
                await this.flushBatch(false);
              }
              this.callbacks.onEntryAdded(rejectedEntry);
              this.notify();
              continue;
            }
          }

          let textEmbedding: number[] = [];
          let coreEmbedding: number[] = [];

          if (this.settings.engine === 'gemini') {
            try {
              const embs = await getEmbeddings([text, coreIdea]);
              textEmbedding = normalizeVector(embs[0] || []);
              coreEmbedding = normalizeVector(embs[1] || []);
            } catch (embErr: any) {
              const status = embErr.status || embErr.code || 500;
              if (status === 429 || status === 503 || embErr.message?.includes('429')) {
                throw embErr;
              }
              const errEntry: AnswerEntry = {
                id: `${this.runId}-${currentAttempt}`,
                runId: this.runId,
                index: currentAttempt,
                text,
                timestamp: Date.now(),
                status: 'error',
                reason: 'Embedding unavailable',
                selectedModel: this.settings.model,
                modelUsed,
              };
              this.entries.push(errEntry);
              this.batchBuffer.push(errEntry);
              this.consecutiveMisses++;
              if (this.batchBuffer.length >= this.settings.perCommit) {
                await this.flushBatch(false);
              }
              this.notify();
              continue;
            }
          }

          const wordSet = Array.from(contentWords(text));

          let isNovel = true;
          let reason: string | undefined = undefined;
          let similarityScore = 0;
          let coreSimilarity = 0;
          let closestMatchIndex: number | null = null;
          let closestMatchId: string | undefined = undefined;
          let closestMatchText: string | undefined = undefined;

          if (this.settings.engine === 'gemini') {
            const gateRes = evaluateGate(
              text,
              textEmbedding,
              coreIdea,
              coreEmbedding,
              this.keptEntries,
              {
                embeddingThreshold: this.settings.embeddingThreshold,
                localThreshold: this.settings.localThreshold,
                tagThreshold: this.settings.tagThreshold,
              },
              observableConsequence,
              counterevidence
            );

            isNovel = gateRes.keep;
            reason = gateRes.reason;
            similarityScore = gateRes.similarityScore || 0;
            coreSimilarity = gateRes.coreSimilarity || 0;
            closestMatchIndex = gateRes.closestMatchIndex ?? null;
            closestMatchId = gateRes.closestMatchId;
            closestMatchText = gateRes.closestMatchText;

            // 5. LLM judge (run only if gates 1-4 pass and settings.useLlmJudge is true)
            if (isNovel && this.settings.useLlmJudge !== false && this.keptEntries.length > 0) {
              const keptCores = this.keptEntries
                .slice(-8)
                .map(e => e.coreIdea || (e.text ? e.text.slice(0, 120) : ''));

              const judge = await llmNoveltyJudge(text, keptCores, coreIdea);
              if (judge.unavailable) {
                this.consecutiveUnavailableJudge++;
                const errEntry: AnswerEntry = {
                  id: `${this.runId}-${currentAttempt}`,
                  runId: this.runId,
                  index: currentAttempt,
                  text,
                  timestamp: Date.now(),
                  status: 'error',
                  reason: 'LLM judge unavailable',
                  selectedModel: this.settings.model,
                  modelUsed,
                  observableConsequence,
                  counterevidence,
                };
                this.entries.push(errEntry);
                this.batchBuffer.push(errEntry);
                this.consecutiveMisses++;

                if (this.consecutiveUnavailableJudge >= 3) {
                  this.status = 'paused';
                  this.notify('LLM judge is unavailable. Check the server or turn the judge off in settings.');
                  break;
                }

                if (this.batchBuffer.length >= this.settings.perCommit) {
                  await this.flushBatch(false);
                }
                this.notify();
                continue;
              } else {
                this.consecutiveUnavailableJudge = 0;
                if (!judge.isNovel) {
                  isNovel = false;
                  reason = `LLM conceptual judge: ${judge.reason}`;
                }
              }
            }
          }

          const entry: AnswerEntry = {
            id: `${this.runId}-${currentAttempt}`,
            runId: this.runId,
            index: currentAttempt,
            text,
            timestamp: Date.now(),
            embedding: textEmbedding,
            coreEmbedding,
            wordSet,
            status: isNovel ? 'kept' : 'rejected',
            coreIdea,
            observableConsequence,
            counterevidence,
            reason,
            similarityScore,
            closestMatchIndex,
            closestMatchId,
            closestMatchText,
            selectedModel: this.settings.model,
            modelUsed,
            fallbackUsed,
            shannonEntropy,
            sanitizedSecrets: detectedSecrets,
            emgAuditPassed,
            persona: currentPersonaName,
          };

          this.entries.push(entry);
          this.batchBuffer.push(entry);

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
          const status = err.status || err.code || 500;
          const errMsg = (err.message || '').toLowerCase();
          const isRateLimited =
            status === 429 ||
            status === 503 ||
            errMsg.includes('429') ||
            errMsg.includes('resource_exhausted') ||
            errMsg.includes('quota') ||
            errMsg.includes('rate limit');
          const isNetworkError =
            errMsg.includes('failed to fetch') ||
            errMsg.includes('network') ||
            errMsg.includes('load failed') ||
            err.name === 'TypeError';

          if (isRateLimited) {
            this.status = 'rate_limited';
            const errEntry: AnswerEntry = {
              id: `${this.runId}-${currentAttempt}`,
              runId: this.runId,
              index: currentAttempt,
              text: '',
              timestamp: Date.now(),
              status: 'error',
              reason: 'Rate limited',
              selectedModel: this.settings.model,
            };
            this.entries.push(errEntry);
            this.batchBuffer.push(errEntry);
            if (this.batchBuffer.length >= this.settings.perCommit) {
              await this.flushBatch(false);
            }
            this.notify('Rate limit exceeded. Run paused. Resume when ready or switch to Sandbox.');
            break;
          } else if (isNetworkError) {
            this.status = 'paused';
            const errEntry: AnswerEntry = {
              id: `${this.runId}-${currentAttempt}`,
              runId: this.runId,
              index: currentAttempt,
              text: '',
              timestamp: Date.now(),
              status: 'error',
              reason: 'Network connection failed',
              selectedModel: this.settings.model,
            };
            this.entries.push(errEntry);
            this.batchBuffer.push(errEntry);
            if (this.batchBuffer.length >= this.settings.perCommit) {
              await this.flushBatch(false);
            }
            this.notify('Network connection failed. Run paused. Check your connection and resume.');
            break;
          } else {
            console.warn('Run iteration error:', err);
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
    } finally {
      this.loopRunning = false;
    }
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
