/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AnswerEntry } from './types';

export interface MacroSynthesis {
  topic: string;
  synthesisAnalysis: string;
  hypotheticalAssumptions: string[];
  researchFrontiers: string[];
  generatedAt: number;
}

function cleanMermaidText(str: string, maxLen = 65): string {
  if (!str) return '';
  return str
    .replace(/["'`;|{}()[\]\\]/g, '') // remove forbidden mermaid delimiter chars
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * Builds a deterministic, zero-latency Mermaid JS topological concept map from kept insights.
 * Follows EMG Core formatting rules: clean node IDs, no unescaped quotes, top-down layout.
 */
export function buildTopologyMermaidGraph(topic: string, keptEntries: AnswerEntry[]): string {
  if (!keptEntries || keptEntries.length === 0) {
    return 'graph TD\n  EMPTY["No kept insights yet. Run sampling to generate concept map."]\n';
  }

  const cleanTopic = cleanMermaidText(topic, 50) || 'Research Objective';
  const lines: string[] = ['graph TD', `  ROOT(["${cleanTopic}"])`];

  // Group entries by persona if available, or cluster into batches of 4
  const personasMap = new Map<string, AnswerEntry[]>();
  for (const entry of keptEntries) {
    const p = entry.persona || 'General Perspective';
    if (!personasMap.has(p)) {
      personasMap.set(p, []);
    }
    personasMap.get(p)!.push(entry);
  }

  let personaIdx = 0;
  for (const [persona, items] of personasMap.entries()) {
    personaIdx++;
    const pId = `P_${personaIdx}`;
    const pClean = cleanMermaidText(persona, 30);
    lines.push(`  ROOT -->|lens| ${pId}["${pClean}"]`);

    items.slice(0, 5).forEach((item, itemIdx) => {
      const ideaId = `I_${item.index}_${itemIdx}`;
      const coreClean = cleanMermaidText(item.coreIdea || item.text, 55);
      lines.push(`  ${pId} --> ${ideaId}["#${item.index}: ${coreClean}"]`);

      if (item.observableConsequence) {
        const obsId = `OBS_${item.index}_${itemIdx}`;
        const obsClean = cleanMermaidText(item.observableConsequence, 50);
        lines.push(`  ${ideaId} -.->|predicts| ${obsId}["Obs: ${obsClean}"]`);
      }
    });
  }

  // Styling classes matching EMG neon/slate themes
  lines.push('');
  lines.push('  classDef default fill:#090d16,stroke:#334155,stroke-width:1.5px,color:#f8fafc;');
  lines.push('  classDef rootNode fill:#1e1b4b,stroke:#6366f1,stroke-width:2px,color:#ffffff,font-weight:bold;');
  lines.push('  classDef personaNode fill:#064e3b,stroke:#10b981,stroke-width:1.5px,color:#6ee7b7;');
  lines.push('  classDef obsNode fill:#451a03,stroke:#f59e0b,stroke-width:1px,color:#fde68a,stroke-dasharray: 4 4;');
  lines.push('  class ROOT rootNode;');

  return lines.join('\n');
}

/**
 * Requests an AI synthesis analysis and underlying assumption breakdown from the server.
 */
export async function requestMacroSynthesis(
  topic: string,
  keptEntries: AnswerEntry[],
  accessToken?: string
): Promise<MacroSynthesis> {
  const payload = {
    topic,
    keptAnswers: keptEntries.slice(0, 20).map((e) => ({
      index: e.index,
      coreIdea: e.coreIdea || '',
      text: e.text || '',
      persona: e.persona,
      observableConsequence: e.observableConsequence,
    })),
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers['x-access-token'] = accessToken;
  }

  const res = await fetch('/api/synthesize', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Synthesis failed (HTTP ${res.status})`);
  }

  const data = await res.json();
  return {
    topic,
    synthesisAnalysis: data.synthesisAnalysis || 'No synthesis analysis provided.',
    hypotheticalAssumptions: Array.isArray(data.hypotheticalAssumptions)
      ? data.hypotheticalAssumptions
      : [],
    researchFrontiers: Array.isArray(data.researchFrontiers) ? data.researchFrontiers : [],
    generatedAt: Date.now(),
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function requestMemoryChat(
  topic: string,
  keptEntries: AnswerEntry[],
  message: string,
  chatHistory: ChatMessage[],
  accessToken?: string
): Promise<string> {
  const payload = {
    topic,
    keptAnswers: keptEntries.slice(0, 15).map((e) => ({
      index: e.index,
      coreIdea: e.coreIdea || '',
      text: e.text || '',
      persona: e.persona,
    })),
    message,
    chatHistory,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers['x-access-token'] = accessToken;
  }

  const res = await fetch('/api/chat-memory', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Chat request failed (HTTP ${res.status})`);
  }

  const data = await res.json();
  return data.reply || '';
}

