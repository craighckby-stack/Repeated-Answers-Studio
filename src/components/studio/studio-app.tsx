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
} from '../../lib/studio/types';
import { StudioRunner } from '../../lib/studio/runner';
import { loadSettings, saveSettings } from '../../lib/studio/storage';
import { setAppAccessToken } from '../../lib/studio/gemini';
import { validateRepoFormat } from '../../lib/studio/github';
import { getSandboxCapacity } from '../../lib/studio/sandbox';
import {
  Play,
  Pause,
  RotateCcw,
  Square,
  Settings,
  Github,
  Download,
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
} from 'lucide-react';

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
    consecutiveMisses: 0,
    entries: [],
    lastCommitBatch: 1,
    commitStatus: 'idle',
  });

  const [activeTab, setActiveTab] = useState<'kept' | 'log' | 'export' | 'settings'>('kept');
  const [copied, setCopied] = useState(false);
  const [warningBanner, setWarningBanner] = useState<string | null>(null);
  const runnerRef = useRef<StudioRunner | null>(null);

  // Load settings on mount & sync access token
  useEffect(() => {
    loadSettings().then((loaded) => {
      setSettings(loaded);
      setAppAccessToken(loaded.appAccessToken);
      setRunState((prev) => ({ ...prev, target: loaded.target }));
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
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    saveSettings(updated);
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
    if (runnerRef.current) {
      setWarningBanner(null);
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

  const exportJSONL = () => {
    const jsonl = keptEntries
      .map((e) => JSON.stringify({ index: e.index, text: e.text, timestamp: e.timestamp, modelUsed: e.modelUsed }))
      .join('\n');
    const blob = new Blob([jsonl], { type: 'application/x-jsonlines' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `repeated-answers-${runState.runId || 'export'}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportMarkdown = () => {
    const md = `# Repeated Answers Studio: ${settings.question}\n\n` +
      keptEntries.map((e, i) => `### ${i + 1}. Attempt #${e.index}${e.modelUsed ? ` (${e.modelUsed})` : ''}\n${e.text}\n`).join('\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `repeated-answers-${runState.runId || 'export'}.md`;
    a.click();
    URL.revokeObjectURL(url);
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
                Gemini Engine
              </span>
            </h1>
            <p className="text-xs text-slate-400">Query models repeatedly, filter semantic duplicates, and compile pristine insights.</p>
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
              <span className="text-xs text-slate-500">{settings.question.length} chars</span>
            </div>
            <textarea
              value={settings.question}
              onChange={(e) => handleSettingChange('question', e.target.value)}
              disabled={runState.status === 'running'}
              rows={3}
              className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition resize-none disabled:opacity-50"
              placeholder="Enter question to test repeatedly..."
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
                  <span className="text-xs text-slate-500 font-normal">({runState.rejectedCount} rejected)</span>
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
            <div className="flex border-b border-slate-800 px-6 py-3 items-center justify-between bg-slate-900/40">
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveTab('kept')}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
                    activeTab === 'kept'
                      ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Kept Answers ({keptEntries.length})
                </button>
                <button
                  onClick={() => setActiveTab('log')}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
                    activeTab === 'log'
                      ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Attempt Log ({runState.entries.length})
                </button>
                <button
                  onClick={() => setActiveTab('export')}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
                    activeTab === 'export'
                      ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Export & Share
                </button>
              </div>

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
                        <span>{new Date(e.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-slate-200 text-sm whitespace-pre-wrap leading-relaxed">{e.text}</p>
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
                          : 'bg-rose-950/10 border-rose-900/30 text-slate-400'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`font-semibold uppercase tracking-wider flex items-center gap-2 ${e.status === 'kept' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          <span>Attempt #{e.index} — {e.status}</span>
                          {e.modelUsed && <span className="text-[10px] text-slate-400 font-mono lowercase">({e.modelUsed})</span>}
                        </span>
                        <span className="text-slate-500">{new Date(e.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-slate-200 line-clamp-2">{e.text}</p>
                      {e.reason && (
                        <p className="text-[11px] text-rose-300/80 italic font-mono bg-rose-950/30 px-2 py-1 rounded">
                          Rejection: {e.reason}
                        </p>
                      )}
                    </div>
                  ))
                )
              )}

              {activeTab === 'export' && (
                <div className="space-y-6 py-4">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-200">Export Formats</h3>
                    <p className="text-xs text-slate-400">Download your compiled unique insights in standard formats for further research or analysis.</p>
                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={exportJSONL}
                        disabled={keptEntries.length === 0}
                        className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-2 shadow transition disabled:opacity-50"
                      >
                        <Download className="w-4 h-4" /> Download JSONL
                      </button>
                      <button
                        onClick={exportMarkdown}
                        disabled={keptEntries.length === 0}
                        className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center gap-2 border border-slate-700 transition disabled:opacity-50"
                      >
                        <Download className="w-4 h-4" /> Download Markdown
                      </button>
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
    </div>
  );
}
