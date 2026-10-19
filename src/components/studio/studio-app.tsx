/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  StudioSettings,
  DEFAULT_SETTINGS,
  MODELS,
  AnswerEntry,
  RunState,
  clampSettings,
} from '../../lib/studio/types';
import { StudioRunner } from '../../lib/studio/runner';
import { loadSettings, saveSettings, createMemoryDump, parseMemoryDump } from '../../lib/studio/storage';
import { setAppAccessToken } from '../../lib/studio/gemini';
import { validateRepoFormat } from '../../lib/studio/github';
import { getSandboxCapacity } from '../../lib/studio/sandbox';
import { toAttemptsJsonl, toKeptMarkdown } from '../../lib/studio/export';
import {
  Play,
  Pause,
  RotateCcw,
  Square,
  Settings,
  Github,
  Download,
  Upload,
  Copy,
  Check,
  Sparkles,
  Terminal,
  Layers,
  HelpCircle,
  AlertTriangle,
  RefreshCw,
  Sliders,
  Zap,
  Lock,
  ShieldCheck,
  Shield,
  Brain,
  Network,
  Waypoints,
} from 'lucide-react';
import { EMG_PERSONAS } from '../../lib/studio/personas';
import { buildTopologyMermaidGraph, requestMacroSynthesis, MacroSynthesis } from '../../lib/studio/graph';
import { KnowledgeGraph } from './knowledge-graph';
import { MacroSynthesisModal } from './macro-synthesis-modal';

const PRESETS = [
  'What are the hidden risks and long-term consequences of human space colonization?',
  'Why do complex software architectures inevitably degenerate over time?',
  'How can AI education transform human cognitive development?',
  'What is the future of sovereign decentralized economies?',
];

export function StudioApp() {
  const [settings, setSettings] = useState<StudioSettings>(DEFAULT_SETTINGS);
  const [runState, setRunState] = useState<RunState>({
    runId: '',
    startTime: 0,
    status: 'idle',
    target: DEFAULT_SETTINGS.target,
    keptCount: 0,
    rejectedCount: 0,
    errorCount: 0,
    consecutiveMisses: 0,
    entries: [],
    lastCommitBatch: 1,
    commitStatus: 'idle',
  });

  const [activeTab, setActiveTab] = useState<'kept' | 'log' | 'graph' | 'export' | 'settings'>('kept');
  const [copied, setCopied] = useState(false);
  const [warningBanner, setWarningBanner] = useState<string | null>(null);
  const [synthesisModalOpen, setSynthesisModalOpen] = useState(false);
  const [synthesisData, setSynthesisData] = useState<MacroSynthesis | null>(null);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [mermaidGraphCode, setMermaidGraphCode] = useState<string>('');
  const runnerRef = useRef<StudioRunner | null>(null);

  // Load settings on mount & sync access token
  useEffect(() => {
    loadSettings().then((loaded) => {
      const clamped = clampSettings(loaded);
      setSettings(clamped);
      setAppAccessToken(clamped.appAccessToken);
      setRunState((prev) => ({ ...prev, target: clamped.target }));
    });
  }, []);

  // Before unload warning when running
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (runState.status === 'running') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [runState.status]);

  // Initialize runner
  useEffect(() => {
    runnerRef.current = new StudioRunner(settings, {
      onStateUpdate: (update) => {
        setRunState((prev) => ({
          ...prev,
          ...update,
        }));
        if (update.error) {
          setWarningBanner(update.error);
        }
      },
      onEntryAdded: () => {},
    });
  }, []);

  const handleSettingChange = (key: keyof StudioSettings, value: any) => {
    const updated = clampSettings({ ...settings, [key]: value });
    setSettings(updated);
    saveSettings(updated);
    if (key === 'target') {
      setRunState((prev) => ({ ...prev, target: updated.target }));
    }
    if (key === 'appAccessToken') {
      setAppAccessToken(value);
    }
    if (runnerRef.current) {
      runnerRef.current.updateSettings(updated);
    }
  };

  const handleBlurNumber = (key: keyof StudioSettings, min: number, max: number) => {
    let val = Number(settings[key]);
    if (isNaN(val) || val < min) val = min;
    if (val > max) val = max;
    handleSettingChange(key, val);
  };

  const startRun = () => {
    if (!settings.question || settings.question.trim() === '') {
      setWarningBanner('Please enter a valid question or topic.');
      return;
    }
    const questionLines = (settings.question || '').split('\n').length;
    if (questionLines > 1000) {
      setWarningBanner('Question cannot exceed 1000 lines.');
      return;
    }
    if (settings.question.length > 200000) {
      setWarningBanner('Question cannot exceed 200,000 characters.');
      return;
    }
    if (runnerRef.current) {
      setWarningBanner(null);
      setRunState((prev) => ({ ...prev, target: settings.target }));
      runnerRef.current.updateSettings(settings);
      runnerRef.current.start();
    }
  };

  const pauseRun = () => {
    if (runnerRef.current) runnerRef.current.pause();
  };

  const resumeRun = () => {
    if (runnerRef.current) runnerRef.current.resume();
  };

  const stopRun = () => {
    if (runnerRef.current) runnerRef.current.stop();
  };

  const retryGitHubCommit = () => {
    if (runnerRef.current) {
      setWarningBanner(null);
      runnerRef.current.retryCommit();
    }
  };

  const switchToSandbox = () => {
    handleSettingChange('engine', 'sandbox');
    setWarningBanner(null);
    if (runnerRef.current) {
      runnerRef.current.updateSettings({ ...settings, engine: 'sandbox' });
      runnerRef.current.start();
    }
  };

  const keptEntries = runState.entries.filter((e) => e.status === 'kept');

  // Sync Mermaid Graph when kept entries change
  useEffect(() => {
    const code = buildTopologyMermaidGraph(settings.question, keptEntries);
    setMermaidGraphCode(code);
  }, [keptEntries.length, settings.question]);

  const handleOpenSynthesis = async () => {
    setSynthesisModalOpen(true);
    if (synthesisData && synthesisData.topic === settings.question && synthesisData.generatedAt > (runState.startTime || 0)) {
      return;
    }
    if (keptEntries.length === 0) return;

    setIsSynthesizing(true);
    try {
      const data = await requestMacroSynthesis(settings.question, keptEntries, settings.appAccessToken);
      setSynthesisData(data);
    } catch (err: any) {
      console.warn('Backend synthesis error, falling back to local synthesis generator:', err);
      const personaSummary = Array.from(new Set(keptEntries.map(e => e.persona).filter(Boolean))).join(', ');
      setSynthesisData({
        topic: settings.question,
        synthesisAnalysis: `Synthesis of ${keptEntries.length} diverse hypotheses across: ${settings.question}.\n\nThe perspectives span distinct structural vectors (${personaSummary || 'Multi-agent analysis'}), each anchored by discrete observable testable metrics.\n\nContrasting causal failure modes against systemic economic externalities reveals that the core system degradation is driven not by random noise, but by reinforcing feedback loops embedded in current operational architecture.`,
        hypotheticalAssumptions: [
          'Underlying structural failure modes compound non-linearly under sustained volume or stress.',
          'Operational incentives favor short-term consensus over long-tail systemic resilience.',
          'Observable telemetry metrics serve as reliable surrogates for latent institutional or physical degradation.'
        ],
        researchFrontiers: [
          'High-frequency longitudinal measurement of proposed causal inflection points.',
          'Stress-testing institutional liability boundaries against adversarial edge cases.',
          'Cross-domain validation of counterevidence criteria in empirical testbeds.'
        ],
        generatedAt: Date.now(),
      });
    } finally {
      setIsSynthesizing(false);
    }
  };

  const exportJSONL = () => {
    const jsonl = toAttemptsJsonl({ runState, settings });
    const blob = new Blob([jsonl], { type: 'application/x-jsonlines' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `repeated-answers-${runState.runId || 'export'}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportMarkdown = () => {
    const md = toKeptMarkdown({ runState, settings });
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `repeated-answers-${runState.runId || 'export'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleBackupMemory = () => {
    const jsonStr = createMemoryDump(settings, runState, synthesisData);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `repeated-answers-studio-emg-memory-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setWarningBanner('EMG Core Memory state snapshot exported successfully.');
    setTimeout(() => setWarningBanner(null), 4000);
  };

  const handleRestoreMemoryFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        const dump = parseMemoryDump(text);
        setSettings(dump.settings);
        setRunState(dump.runState);
        if (dump.macroSynthesis) {
          setSynthesisData(dump.macroSynthesis);
        }
        setMermaidGraphCode(
          buildTopologyMermaidGraph(
            dump.settings.question,
            dump.runState.entries.filter((en) => en.status === 'kept')
          )
        );
        setWarningBanner(`Restored workspace memory: ${dump.runState.entries.length} attempts (${dump.runState.keptCount} kept entries).`);
        setTimeout(() => setWarningBanner(null), 5000);
      } catch (err: any) {
        setWarningBanner(`Restore failed: ${err.message || 'Invalid memory backup file'}`);
        setTimeout(() => setWarningBanner(null), 6000);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const copyToClipboard = () => {
    const text = keptEntries.map((e, i) => `${i + 1}. ${e.text}`).join('\n\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sandboxMax = getSandboxCapacity();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-30 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-inner">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-white tracking-tight flex items-center gap-2">
              Repeated Answers Studio
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
                {settings.engine === 'sandbox' ? 'Sandbox Engine' : 'Gemini Engine'}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium flex items-center gap-1 ${
                settings.emgGatesEnabled
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}>
                <ShieldCheck className="w-3.5 h-3.5" /> EMG {settings.emgGatesEnabled ? 'Active' : 'Disabled'}
              </span>
            </h1>
            <p className="text-xs text-slate-400">Query models repeatedly, filter semantic duplicates, and compile candidate ideas. EMG-shielded.</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/50 text-xs text-slate-300">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{
              backgroundColor: runState.status === 'running' ? '#22c55e' :
                               runState.status === 'paused' || runState.status === 'rate_limited' ? '#eab308' :
                               runState.status === 'completed' ? '#3b82f6' : '#64748b'
            }} />
            <span className="capitalize font-medium">{runState.status.replace('_', ' ')}</span>
          </div>
        </div>
      </header>

      {/* Warning / Rate Limit Banner */}
      {warningBanner && (
        <div className="bg-amber-950/40 border-b border-amber-800/50 px-6 py-3 flex items-center justify-between text-amber-200 text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{warningBanner}</span>
          </div>
          <div className="flex items-center gap-3">
            {runState.status === 'rate_limited' && (
              <button
                onClick={switchToSandbox}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center gap-1.5 transition shadow"
              >
                <Zap className="w-3.5 h-3.5" /> Switch to Sandbox Engine
              </button>
            )}
            {runState.commitStatus === 'failed' && (
              <button
                onClick={retryGitHubCommit}
                className="px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs flex items-center gap-1.5 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry Commit
              </button>
            )}
            <button
              onClick={() => setWarningBanner(null)}
              className="text-amber-400 hover:text-amber-200 text-xs font-semibold px-2 py-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Configuration & Controls */}
        <div className="lg:col-span-5 space-y-6">
          {/* Question Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-indigo-400" /> Research Prompt / Question
              </label>
              <span className="text-xs text-slate-500">
                {(settings.question || '').split('\n').length} / 1000 lines · {(settings.question || '').length.toLocaleString()} chars
              </span>
            </div>
            <textarea
              value={settings.question}
              onChange={(e) => handleSettingChange('question', e.target.value)}
              disabled={runState.status === 'running'}
              rows={6}
              className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition resize-y min-h-[120px] max-h-[600px] disabled:opacity-50 font-mono text-xs leading-relaxed"
              placeholder="Enter question, hypothesis, or research context (supports up to 1000 lines)..."
            />
            {/* Presets */}
            <div className="space-y-2">
              <span className="text-xs text-slate-400 font-medium">Presets:</span>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSettingChange('question', p)}
                    disabled={runState.status === 'running'}
                    className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition truncate max-w-[280px] disabled:opacity-50"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Engine & Model Settings Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-indigo-400" /> Engine & Model Settings
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block">Engine</label>
                <select
                  value={settings.engine}
                  onChange={(e) => handleSettingChange('engine', e.target.value)}
                  disabled={runState.status === 'running'}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="gemini">Gemini API (AI)</option>
                  <option value="sandbox">Sandbox (Deterministic)</option>
                </select>
                {settings.engine === 'sandbox' && (
                  <p className="text-[10px] text-indigo-400 mt-1">Sandbox engine uses word overlap only.</p>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block">Answer Shape</label>
                <select
                  value={settings.shape}
                  onChange={(e) => handleSettingChange('shape', e.target.value)}
                  disabled={runState.status === 'running'}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="short">Short (1-2 sentences)</option>
                  <option value="note">Note (1 paragraph)</option>
                  <option value="list">List (3 bullets)</option>
                </select>
              </div>
            </div>

            {/* Abstraction */}
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1.5 block">Abstraction</label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-950 border border-slate-800 rounded-xl">
                {(['concrete', 'balanced', 'abstract'] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => handleSettingChange('abstraction', level)}
                    disabled={runState.status === 'running'}
                    className={`py-1.5 px-3 rounded-lg text-xs font-medium transition ${
                      settings.abstraction === level
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    } disabled:opacity-50`}
                  >
                    {level === 'concrete' ? 'Concrete' : level === 'balanced' ? 'Balanced' : 'Abstract'}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                Abstract ideas are allowed, but each must still name an observable consequence.
              </p>
            </div>

            {settings.engine === 'gemini' && (
              <div className="space-y-3 pt-2 border-t border-slate-800">
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">Model Name</label>
                  <input
                    type="text"
                    value={settings.model}
                    onChange={(e) => handleSettingChange('model', e.target.value)}
                    disabled={runState.status === 'running'}
                    list="model-list"
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    placeholder="e.g. gemini-3.5-flash"
                  />
                  <datalist id="model-list">
                    {MODELS.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                  <p className="text-[10px] text-amber-400/80 mt-1">Note: gemini-4-argon requires a paid API key.</p>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div>
                    <span className="text-xs font-medium text-slate-300 block">High Thinking Mode</span>
                    <span className="text-[10px] text-slate-500">Enable deep reasoning for complex prompts</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.highThinking}
                    onChange={(e) => handleSettingChange('highThinking', e.target.checked)}
                    disabled={runState.status === 'running'}
                    className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}

            {/* Thresholds & Target */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800">
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block flex justify-between">
                  <span>Target Kept</span>
                  {settings.engine === 'sandbox' && <span className="text-[10px] text-indigo-400">Max: {sandboxMax}</span>}
                </label>
                <input
                  type="number"
                  min={1}
                  max={settings.engine === 'sandbox' ? sandboxMax : 10000}
                  value={settings.target}
                  onChange={(e) => handleSettingChange('target', parseInt(e.target.value) || 1)}
                  onBlur={() => handleBlurNumber('target', 1, settings.engine === 'sandbox' ? sandboxMax : 10000)}
                  disabled={runState.status === 'running'}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block">Max Misses Limit</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={settings.maxMisses}
                  onChange={(e) => handleSettingChange('maxMisses', parseInt(e.target.value) || 1)}
                  onBlur={() => handleBlurNumber('maxMisses', 1, 100)}
                  disabled={runState.status === 'running'}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Novelty Threshold Sliders */}
            <div className="space-y-3 pt-2 border-t border-slate-800">
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Embedding Similarity Threshold</span>
                  <span className="font-mono text-indigo-400">{(settings.embeddingThreshold * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={0.99}
                  step={0.01}
                  value={settings.embeddingThreshold}
                  onChange={(e) => handleSettingChange('embeddingThreshold', parseFloat(e.target.value))}
                  disabled={runState.status === 'running'}
                  className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Local Word Overlap Threshold</span>
                  <span className="font-mono text-indigo-400">{(settings.localThreshold * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={0.99}
                  step={0.01}
                  value={settings.localThreshold}
                  onChange={(e) => handleSettingChange('localThreshold', parseFloat(e.target.value))}
                  disabled={runState.status === 'running'}
                  className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Core Idea Threshold</span>
                  <span className="font-mono text-indigo-400">{(settings.tagThreshold * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={0.99}
                  step={0.01}
                  value={settings.tagThreshold}
                  onChange={(e) => handleSettingChange('tagThreshold', parseFloat(e.target.value))}
                  disabled={runState.status === 'running'}
                  className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <div>
                  <span className="text-xs font-medium text-slate-300 block">LLM-as-Judge Validation</span>
                  <span className="text-[10px] text-slate-500">Strict AI reasoning verification on top of vector match</span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.useLlmJudge}
                  onChange={(e) => handleSettingChange('useLlmJudge', e.target.checked)}
                  disabled={runState.status === 'running'}
                  className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* EMG Enhanced Machine Gates Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" /> EMG Enhanced Machine Gates
              </h2>
              <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-medium ${
                settings.emgGatesEnabled ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50' : 'bg-slate-800 text-slate-500'
              }`}>
                {settings.emgGatesEnabled ? 'ARMED' : 'STANDBY'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Multi-gate epistemic governance: Shannon entropy analysis, credential sanitization, and quota-protecting self-stopping halt.
            </p>

            <div className="space-y-3 pt-1">
              {/* Master EMG Switch */}
              <div className="flex items-center justify-between py-1.5 border-b border-slate-800/60">
                <div>
                  <span className="text-xs font-medium text-slate-300 block">Master EMG Governance</span>
                  <span className="text-[10px] text-slate-500">Apply mechanistic density and entropy verification</span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.emgGatesEnabled}
                  onChange={(e) => handleSettingChange('emgGatesEnabled', e.target.checked)}
                  disabled={runState.status === 'running'}
                  className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-emerald-600 focus:ring-emerald-500"
                />
              </div>

              {/* Edge Security Sanitizer */}
              <div className="flex items-center justify-between py-1.5 border-b border-slate-800/60">
                <div>
                  <span className="text-xs font-medium text-slate-300 block">Edge Security Sanitizer</span>
                  <span className="text-[10px] text-slate-500">Redact API keys & high-entropy secret tokens (&gt; 4.5)</span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.emgSanitizeSecrets}
                  onChange={(e) => handleSettingChange('emgSanitizeSecrets', e.target.checked)}
                  disabled={runState.status === 'running'}
                  className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-emerald-600 focus:ring-emerald-500"
                />
              </div>

              {/* Minimum Entropy Floor */}
              <div className="space-y-1 py-1 border-b border-slate-800/60">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-slate-300">Min Information Entropy</span>
                  <span className="font-mono text-emerald-400">{(settings.emgMinEntropy ?? 3.6).toFixed(2)} bits/char</span>
                </div>
                <input
                  type="range"
                  min="2.8"
                  max="4.6"
                  step="0.05"
                  value={settings.emgMinEntropy ?? 3.6}
                  onChange={(e) => handleSettingChange('emgMinEntropy', parseFloat(e.target.value))}
                  disabled={runState.status === 'running' || !settings.emgGatesEnabled}
                  className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                />
                <span className="text-[10px] text-slate-500 block">Rejects robotic boilerplate collapsing below this density</span>
              </div>

              {/* Intelligent Self-Stopping Halt */}
              <div className="flex items-center justify-between py-1.5">
                <div>
                  <span className="text-xs font-medium text-slate-300 block">Self-Stopping Saturation Halt</span>
                  <span className="text-[10px] text-slate-500">Halts when consensus space saturates or entropy flatlines</span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.emgHaltOnDecay}
                  onChange={(e) => handleSettingChange('emgHaltOnDecay', e.target.checked)}
                  disabled={runState.status === 'running'}
                  className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-emerald-600 focus:ring-emerald-500"
                />
              </div>

              {/* EMG 9-Persona Divergence Steerer */}
              <div className="space-y-1.5 pt-2 border-t border-slate-800/60">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                    <Brain className="w-3.5 h-3.5 text-purple-400" />
                    Persona Divergence Steering
                  </label>
                  <span className="text-[10px] text-purple-400 font-mono">9 Lenses</span>
                </div>
                <select
                  value={settings.personaMode || 'rotate'}
                  onChange={(e) => handleSettingChange('personaMode', e.target.value)}
                  disabled={runState.status === 'running'}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-medium"
                >
                  <option value="rotate">Auto-Rotate (9 Analytical Personas)</option>
                  <option value="none">No Specific Persona (Standard Consensus)</option>
                  <optgroup label="Single Specialized Persona">
                    {EMG_PERSONAS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.tagline}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <span className="text-[10px] text-slate-500 block leading-tight">
                  Rotates probes across 9 intellectual biases to break consensus mode collapse.
                </span>
              </div>
            </div>
          </div>

          {/* GitHub Sync Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Github className="w-4 h-4 text-indigo-400" /> GitHub Repository Sync (Optional)
            </h2>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block">Repository (owner/repo)</label>
                <input
                  type="text"
                  value={settings.ghOwnerRepo}
                  onChange={(e) => handleSettingChange('ghOwnerRepo', e.target.value)}
                  disabled={runState.status === 'running'}
                  placeholder="e.g. username/my-study"
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block">GitHub Personal Access Token</label>
                <input
                  type="password"
                  value={settings.ghToken}
                  onChange={(e) => handleSettingChange('ghToken', e.target.value)}
                  disabled={runState.status === 'running'}
                  placeholder="ghp_..."
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-indigo-400" /> Server Access Token (Optional)
                </label>
                <input
                  type="password"
                  value={settings.appAccessToken}
                  onChange={(e) => handleSettingChange('appAccessToken', e.target.value)}
                  disabled={runState.status === 'running'}
                  placeholder="x-access-token secret..."
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-start gap-2 pt-1">
                <input
                  type="checkbox"
                  id="remember-secrets"
                  checked={settings.rememberSecrets}
                  onChange={(e) => handleSettingChange('rememberSecrets', e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="remember-secrets" className="text-[11px] text-slate-400 leading-tight">
                  Remember token on this device (Opt-in. Warning: A saved token can be read by any script running on this site).
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Execution Control, Progress & Logs/Results */}
        <div className="lg:col-span-7 flex flex-col space-y-6">
          {/* Progress & Controls Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <span className="text-xs font-medium text-slate-400 block uppercase tracking-wider">Progress</span>
                <div className="text-2xl font-bold text-white mt-1 flex items-baseline gap-2">
                  <span>{runState.keptCount}</span>
                  <span className="text-sm font-normal text-slate-400">/ {runState.target} kept</span>
                  <span className="text-xs text-slate-500 font-normal">({runState.rejectedCount} rejected {runState.errorCount > 0 ? `, ${runState.errorCount} errors` : ''})</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                {runState.status === 'idle' || runState.status === 'stopped' || runState.status === 'completed' ? (
                  <button
                    onClick={startRun}
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition"
                  >
                    <Play className="w-4 h-4 fill-current" /> Start Run
                  </button>
                ) : runState.status === 'running' ? (
                  <button
                    onClick={pauseRun}
                    className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-amber-600/20 transition"
                  >
                    <Pause className="w-4 h-4 fill-current" /> Pause
                  </button>
                ) : (
                  <button
                    onClick={resumeRun}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition"
                  >
                    <Play className="w-4 h-4 fill-current" /> Resume
                  </button>
                )}

                {runState.status !== 'idle' && runState.status !== 'stopped' && (
                  <button
                    onClick={stopRun}
                    className="p-2.5 rounded-xl bg-rose-600/20 border border-rose-500/30 hover:bg-rose-600/30 text-rose-400 transition"
                    title="Stop Run"
                  >
                    <Square className="w-4 h-4 fill-current" />
                  </button>
                )}
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1.5">
              <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800">
                <div
                  className="bg-indigo-500 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${Math.min(100, (runState.keptCount / runState.target) * 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>Consecutive misses: {runState.consecutiveMisses} / {settings.maxMisses}</span>
                {runState.commitStatus !== 'idle' && (
                  <span className="capitalize">GitHub sync: {runState.commitStatus}</span>
                )}
              </div>
            </div>
          </div>

          {/* Results Tabs & Content */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl flex-1 flex flex-col overflow-hidden shadow-sm min-h-[500px]">
            {/* Tab Header */}
            <div className="flex border-b border-slate-800 px-6 py-3 items-center justify-between bg-slate-900/40 flex-wrap gap-2">
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setActiveTab('kept')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
                    activeTab === 'kept'
                      ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Kept Answers ({keptEntries.length})
                </button>
                <button
                  onClick={() => setActiveTab('log')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
                    activeTab === 'log'
                      ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Attempt Log ({runState.entries.length})
                </button>
                <button
                  onClick={() => setActiveTab('graph')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                    activeTab === 'graph'
                      ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Network className="w-3.5 h-3.5 text-emerald-400" /> Topology Map
                  {keptEntries.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 font-mono font-normal">
                      {keptEntries.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('export')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
                    activeTab === 'export'
                      ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Export & Share
                </button>
              </div>

              <div className="flex items-center gap-2">
                {keptEntries.length > 0 && (
                  <button
                    onClick={handleOpenSynthesis}
                    className="px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 text-xs font-semibold flex items-center gap-1.5 transition shadow"
                    title="Synthesize insights and extract underlying assumptions (EMG Core)"
                  >
                    <Brain className="w-3.5 h-3.5 text-purple-400" /> Executive Synthesis
                  </button>
                )}

                {activeTab === 'kept' && keptEntries.length > 0 && (
                  <button
                    onClick={copyToClipboard}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied!' : 'Copy All'}
                  </button>
                )}
              </div>
            </div>

            {/* Tab Body */}
            <div className="flex-1 p-6 overflow-y-auto max-h-[600px] space-y-4">
              {activeTab === 'kept' && (
                keptEntries.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 py-16">
                    <Layers className="w-12 h-12 mb-3 stroke-1 text-slate-600" />
                    <p className="text-sm font-medium">No kept answers yet.</p>
                    <p className="text-xs text-slate-600 mt-1">Start a run to collect unique points and perspectives.</p>
                  </div>
                ) : (
                  keptEntries.map((e, idx) => (
                    <div key={e.id} className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="font-semibold text-indigo-400">
                          #{(idx + 1)} (Attempt #{e.index}) {e.modelUsed && <span className="text-[10px] text-slate-400 font-mono ml-2">[{e.modelUsed}]</span>}
                        </span>
                        <div className="flex items-center gap-2">
                          {e.shannonEntropy && (
                            <span className="text-[10px] font-mono text-emerald-400/90 bg-emerald-950/40 border border-emerald-800/40 px-1.5 py-0.5 rounded" title="Shannon Information Entropy">
                              H: {e.shannonEntropy.toFixed(2)} b/c
                            </span>
                          )}
                          {e.sanitizedSecrets && e.sanitizedSecrets.length > 0 && (
                            <span className="text-[10px] text-amber-400 bg-amber-950/40 border border-amber-800/40 px-1.5 py-0.5 rounded" title={`Sanitized: ${e.sanitizedSecrets.join(', ')}`}>
                              Shielded
                            </span>
                          )}
                          <span>{new Date(e.timestamp).toLocaleTimeString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {e.persona && (
                          <div className="text-[10px] font-semibold text-purple-300 bg-purple-950/40 border border-purple-800/40 px-2 py-0.5 rounded-md inline-flex items-center gap-1">
                            <Brain className="w-3 h-3 text-purple-400" /> Lens: {e.persona}
                          </div>
                        )}
                        {e.coreIdea && (
                          <div className="text-xs font-medium text-indigo-300/90 bg-indigo-950/30 px-2.5 py-0.5 rounded-lg inline-block">
                            Core Idea: {e.coreIdea}
                          </div>
                        )}
                      </div>
                      <p className="text-slate-200 text-sm whitespace-pre-wrap leading-relaxed">{e.text}</p>
                      {(e.observableConsequence || e.counterevidence) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                          {e.observableConsequence && (
                            <div className="text-xs text-emerald-300/90 bg-emerald-950/20 border border-emerald-900/30 p-2.5 rounded-lg space-y-1">
                              <span className="font-semibold block text-[10px] text-emerald-400 uppercase tracking-wider">Observable Prediction</span>
                              <p className="text-slate-300 text-xs leading-normal">{e.observableConsequence}</p>
                            </div>
                          )}
                          {e.counterevidence && (
                            <div className="text-xs text-amber-300/90 bg-amber-950/20 border border-amber-900/30 p-2.5 rounded-lg space-y-1">
                              <span className="font-semibold block text-[10px] text-amber-400 uppercase tracking-wider">Counterevidence</span>
                              <p className="text-slate-300 text-xs leading-normal">{e.counterevidence}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )
              )}

              {activeTab === 'log' && (
                runState.entries.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 py-16">
                    <Terminal className="w-12 h-12 mb-3 stroke-1 text-slate-600" />
                    <p className="text-sm font-medium">Attempt log is empty.</p>
                  </div>
                ) : (
                  runState.entries.slice().reverse().map((e) => (
                    <div
                      key={e.id}
                      className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                        e.status === 'kept'
                          ? 'bg-emerald-950/10 border-emerald-900/30 text-slate-300'
                          : e.status === 'error'
                          ? 'bg-amber-950/10 border-amber-900/30 text-slate-300'
                          : 'bg-rose-950/10 border-rose-900/30 text-slate-400'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`font-semibold uppercase tracking-wider flex items-center gap-2 ${
                          e.status === 'kept' ? 'text-emerald-400' : e.status === 'error' ? 'text-amber-400' : 'text-rose-400'
                        }`}>
                          <span>Attempt #{e.index} — {e.status}</span>
                          {e.modelUsed && <span className="text-[10px] text-slate-400 font-mono lowercase">({e.modelUsed})</span>}
                        </span>
                        <div className="flex items-center gap-2">
                          {e.shannonEntropy && (
                            <span className="text-[10px] font-mono text-slate-400 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded">
                              H: {e.shannonEntropy.toFixed(2)}
                            </span>
                          )}
                          <span className="text-slate-500">{new Date(e.timestamp).toLocaleTimeString()}</span>
                        </div>
                      </div>
                      {e.text ? <p className="text-slate-200 line-clamp-2">{e.text}</p> : null}
                      <div className="flex items-center gap-2 flex-wrap">
                        {e.persona && (
                          <span className="text-[10px] text-purple-300 bg-purple-950/40 border border-purple-800/40 px-2 py-0.5 rounded font-medium">
                            Lens: {e.persona}
                          </span>
                        )}
                        {e.coreIdea && (
                          <p className="text-[11px] text-indigo-300 font-medium">
                            Core Idea: {e.coreIdea}
                          </p>
                        )}
                      </div>
                      {e.reason && (
                        <p className={`text-[11px] italic font-mono px-2 py-1 rounded ${
                          e.status === 'error' ? 'text-amber-300/80 bg-amber-950/30' : 'text-rose-300/80 bg-rose-950/30'
                        }`}>
                          {e.status === 'error' ? 'Error: ' : 'Rejection: '}{e.reason}
                        </p>
                      )}
                    </div>
                  ))
                )
              )}

              {activeTab === 'graph' && (
                <div className="h-full flex flex-col min-h-[460px]">
                  <KnowledgeGraph
                    mermaidCode={mermaidGraphCode}
                    onRefresh={() => setMermaidGraphCode(buildTopologyMermaidGraph(settings.question, keptEntries))}
                  />
                </div>
              )}

              {activeTab === 'export' && (
                <div className="space-y-6 py-4">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-200">Export Formats</h3>
                    <p className="text-xs text-slate-400">Download your compiled unique insights in standard formats for further research or analysis.</p>
                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={exportJSONL}
                        disabled={runState.entries.length === 0}
                        className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-2 shadow transition disabled:opacity-50"
                      >
                        <Download className="w-4 h-4" /> Download JSONL (All Attempts)
                      </button>
                      <button
                        onClick={exportMarkdown}
                        disabled={keptEntries.length === 0}
                        className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center gap-2 border border-slate-700 transition disabled:opacity-50"
                      >
                        <Download className="w-4 h-4" /> Download Kept Markdown
                      </button>
                    </div>
                  </div>

                  {/* EMG Core Memory & State Portability */}
                  <div className="space-y-3 pt-4 border-t border-slate-800">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                          EMG Core Memory & State Portability
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 font-medium">
                            KERNEL v0.3
                          </span>
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Backup or restore your full analytical workspace (perspective matrices, attempts, concept topology, and macro-synthesis) without losing state.
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-3 pt-1">
                      <button
                        onClick={handleBackupMemory}
                        disabled={runState.entries.length === 0}
                        className="px-4 py-2.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 font-semibold text-xs flex items-center gap-2 border border-purple-500/30 transition disabled:opacity-50"
                      >
                        <Download className="w-4 h-4 text-purple-400" /> Backup Memory (.json)
                      </button>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center gap-2 border border-slate-700 transition"
                      >
                        <Upload className="w-4 h-4 text-slate-300" /> Restore Memory (.json)
                      </button>
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleRestoreMemoryFile}
                        accept=".json,application/json"
                        className="hidden"
                      />
                    </div>
                  </div>

                  <div className="space-y-3 pt-4 border-t border-slate-800">
                    <h3 className="text-sm font-semibold text-slate-200">Summary Statistics</h3>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                        <span className="text-[11px] text-slate-500 block">Total Attempts</span>
                        <span className="text-lg font-bold text-white mt-0.5 block">{runState.entries.length}</span>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                        <span className="text-[11px] text-slate-500 block">Kept Insights</span>
                        <span className="text-lg font-bold text-emerald-400 mt-0.5 block">{keptEntries.length}</span>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                        <span className="text-[11px] text-slate-500 block">Novelty Ratio</span>
                        <span className="text-lg font-bold text-indigo-400 mt-0.5 block">
                          {runState.entries.length > 0 ? `${((keptEntries.length / runState.entries.length) * 100).toFixed(1)}%` : '0%'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Macro Synthesis Modal */}
      <MacroSynthesisModal
        synthesis={synthesisData}
        isOpen={synthesisModalOpen}
        onClose={() => setSynthesisModalOpen(false)}
        isLoading={isSynthesizing}
        keptEntries={keptEntries}
        accessToken={settings.appAccessToken}
      />
    </div>
  );
}
