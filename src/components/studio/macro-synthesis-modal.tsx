/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { MacroSynthesis, requestMemoryChat, ChatMessage } from '../../lib/studio/graph';
import { AnswerEntry } from '../../lib/studio/types';
import { Sparkles, X, Copy, Check, Download, Brain, Compass, Key, MessageSquare, Send, Bot, User, RefreshCw } from 'lucide-react';

interface MacroSynthesisModalProps {
  synthesis: MacroSynthesis | null;
  isOpen: boolean;
  onClose: () => void;
  isLoading?: boolean;
  keptEntries?: AnswerEntry[];
  accessToken?: string;
}

export function MacroSynthesisModal({
  synthesis,
  isOpen,
  onClose,
  isLoading,
  keptEntries = [],
  accessToken,
}: MacroSynthesisModalProps) {
  const [copied, setCopied] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'report' | 'chat'>('report');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputQuestion, setInputQuestion] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeSubTab === 'chat') {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, activeSubTab]);

  const handleSendChat = async (promptText?: string) => {
    const textToSend = (promptText || inputQuestion).trim();
    if (!textToSend || isChatLoading) return;

    setInputQuestion('');
    setChatError(null);
    const newHistory: ChatMessage[] = [...chatMessages, { role: 'user', content: textToSend }];
    setChatMessages(newHistory);
    setIsChatLoading(true);

    try {
      const topic = synthesis?.topic || 'Research Subject';
      const reply = await requestMemoryChat(topic, keptEntries, textToSend, newHistory, accessToken);
      setChatMessages([...newHistory, { role: 'assistant', content: reply }]);
    } catch (err: any) {
      setChatError(err.message || 'Chat generation failed');
    } finally {
      setIsChatLoading(false);
    }
  };

  if (!isOpen) return null;

  const toMarkdown = () => {
    if (!synthesis) return '';
    let md = `# Repeated Answers Studio: Macro Synthesis\n\n`;
    md += `- **Topic**: ${synthesis.topic}\n`;
    md += `- **Generated**: ${new Date(synthesis.generatedAt).toISOString()}\n\n`;
    md += `## Executive Synthesis Analysis\n\n${synthesis.synthesisAnalysis}\n\n`;
    if (synthesis.hypotheticalAssumptions?.length > 0) {
      md += `## Uncovered Hypothetical Assumptions\n\n`;
      synthesis.hypotheticalAssumptions.forEach((a, i) => {
        md += `${i + 1}. ${a}\n`;
      });
      md += '\n';
    }
    if (synthesis.researchFrontiers?.length > 0) {
      md += `## Emergent Research Frontiers\n\n`;
      synthesis.researchFrontiers.forEach((f, i) => {
        md += `- **${f}**\n`;
      });
      md += '\n';
    }
    return md;
  };

  const copyMarkdown = () => {
    navigator.clipboard.writeText(toMarkdown());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadMarkdown = () => {
    const md = toMarkdown();
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `repeated-answers-macro-synthesis-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Executive Synthesis & Assumption Mining
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 font-medium">
                  EMG Core
                </span>
              </h2>
              <p className="text-xs text-slate-400">Cross-insight macro analysis and hidden epistemic assumptions</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sub-tab Navigation */}
        <div className="flex border-b border-slate-800 px-6 py-2 bg-slate-900/50 gap-2">
          <button
            onClick={() => setActiveSubTab('report')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              activeSubTab === 'report'
                ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Brain className="w-3.5 h-3.5" /> Synthesis Report & Assumptions
          </button>
          <button
            onClick={() => setActiveSubTab('chat')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              activeSubTab === 'chat'
                ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" /> Conversational Mind
            {chatMessages.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-purple-500/30 text-[10px] text-purple-200">
                {chatMessages.length}
              </span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-200">
          {isLoading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400">
              <Sparkles className="w-8 h-8 text-purple-400 animate-spin" />
              <p className="text-sm font-medium">Synthesizing perspectives & mining assumptions...</p>
              <p className="text-xs text-slate-600">Cross-referencing kept core ideas and causal mechanisms</p>
            </div>
          ) : !synthesis ? (
            <div className="py-16 text-center text-slate-500">
              <p className="text-sm font-medium">No synthesis available.</p>
            </div>
          ) : activeSubTab === 'chat' ? (
            /* Conversational Mind View */
            <div className="flex flex-col h-full min-h-[420px] space-y-4">
              <div className="p-3 rounded-xl bg-purple-950/20 border border-purple-900/40 text-xs text-purple-300 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-purple-400" />
                  Grounded in <strong>{keptEntries.length}</strong> kept perspectives and hypotheses for this topic.
                </span>
                {chatMessages.length > 0 && (
                  <button
                    onClick={() => setChatMessages([])}
                    className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" /> Clear Chat
                  </button>
                )}
              </div>

              {/* Message List */}
              <div className="flex-1 overflow-y-auto space-y-3 pr-1 max-h-[360px]">
                {chatMessages.length === 0 ? (
                  <div className="py-10 text-center space-y-4">
                    <div className="w-10 h-10 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-purple-400">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-white">Ask the Collective Mind</h4>
                      <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                        Inquire about disagreements across perspectives, interrogate underlying assumptions, or probe specific hypotheses.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center max-w-lg mx-auto pt-2">
                      <button
                        onClick={() => handleSendChat('What are the biggest points of tension across these perspective streams?')}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs text-slate-300 border border-slate-700/60 transition text-left"
                      >
                        "What are the biggest points of tension?"
                      </button>
                      <button
                        onClick={() => handleSendChat('Which uncoverd assumption is most vulnerable to empirical falsification?')}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs text-slate-300 border border-slate-700/60 transition text-left"
                      >
                        "Which assumption is most falsifiable?"
                      </button>
                      <button
                        onClick={() => handleSendChat('Summarize the concrete causal leverage points and observable predictions.')}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs text-slate-300 border border-slate-700/60 transition text-left"
                      >
                        "Summarize causal leverage points"
                      </button>
                    </div>
                  </div>
                ) : (
                  chatMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex gap-3 text-xs leading-relaxed ${
                        msg.role === 'user' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      {msg.role === 'assistant' && (
                        <div className="w-7 h-7 rounded-lg bg-purple-600/30 border border-purple-500/40 flex items-center justify-center text-purple-300 shrink-0 mt-0.5">
                          <Bot className="w-4 h-4" />
                        </div>
                      )}
                      <div
                        className={`p-3 rounded-2xl max-w-[85%] whitespace-pre-wrap ${
                          msg.role === 'user'
                            ? 'bg-indigo-600 text-white rounded-tr-none'
                            : 'bg-slate-950/90 border border-slate-800 text-slate-200 rounded-tl-none font-sans'
                        }`}
                      >
                        {msg.content}
                      </div>
                      {msg.role === 'user' && (
                        <div className="w-7 h-7 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300 shrink-0 mt-0.5">
                          <User className="w-4 h-4" />
                        </div>
                      )}
                    </div>
                  ))
                )}
                {isChatLoading && (
                  <div className="flex gap-3 text-xs justify-start items-center text-slate-400">
                    <div className="w-7 h-7 rounded-lg bg-purple-600/30 border border-purple-500/40 flex items-center justify-center text-purple-300 shrink-0">
                      <Sparkles className="w-4 h-4 animate-spin text-purple-400" />
                    </div>
                    <span className="italic">Querying collective perspectives...</span>
                  </div>
                )}
                {chatError && (
                  <div className="p-3 rounded-xl bg-rose-950/20 border border-rose-900/40 text-xs text-rose-300">
                    {chatError}
                  </div>
                )}
                <div ref={chatBottomRef} />
              </div>

              {/* Chat Input Bar */}
              <div className="pt-2 flex gap-2">
                <input
                  type="text"
                  value={inputQuestion}
                  onChange={(e) => setInputQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendChat();
                    }
                  }}
                  placeholder="Ask a question about these synthesized perspectives..."
                  disabled={isChatLoading}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 transition disabled:opacity-60"
                />
                <button
                  onClick={() => handleSendChat()}
                  disabled={!inputQuestion.trim() || isChatLoading}
                  className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow transition disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" /> Send
                </button>
              </div>
            </div>
          ) : (
            /* Report View */
            <>
              {/* Executive Essay */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> Macro Synthesis Analysis
                </h3>
                <div className="bg-slate-950/80 border border-slate-800/80 p-4 rounded-xl text-sm leading-relaxed text-slate-300 whitespace-pre-wrap font-sans">
                  {synthesis.synthesisAnalysis}
                </div>
              </div>

              {/* Underlying Assumptions */}
              {synthesis.hypotheticalAssumptions?.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5" /> Uncovered Epistemic Assumptions
                  </h3>
                  <div className="space-y-2">
                    {synthesis.hypotheticalAssumptions.map((assump, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-amber-950/10 border border-amber-900/30 text-xs text-amber-200 flex items-start gap-2.5"
                      >
                        <span className="font-mono text-amber-400 font-bold shrink-0">{idx + 1}.</span>
                        <p className="leading-normal">{assump}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Research Frontiers */}
              {synthesis.researchFrontiers?.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5" /> Emergent Research Frontiers
                  </h3>
                  <div className="space-y-2">
                    {synthesis.researchFrontiers.map((front, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-emerald-950/10 border border-emerald-900/30 text-xs text-emerald-200 flex items-start gap-2.5"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                        <p className="leading-normal">{front}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            {synthesis ? `${synthesis.hypotheticalAssumptions?.length || 0} assumptions mined · ${keptEntries.length} perspectives referenced` : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={copyMarkdown}
              disabled={!synthesis || isLoading}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-50"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy Markdown'}</span>
            </button>
            <button
              onClick={downloadMarkdown}
              disabled={!synthesis || isLoading}
              className="px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow transition disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" /> Download Report
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
