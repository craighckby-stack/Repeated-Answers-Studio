/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { Copy, Check, Download, RefreshCw, ZoomIn, ZoomOut, AlertCircle, Eye, Code } from 'lucide-react';

interface KnowledgeGraphProps {
  mermaidCode: string;
  onRefresh?: () => void;
  isGenerating?: boolean;
}

export function KnowledgeGraph({ mermaidCode, onRefresh, isGenerating }: KnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'diagram' | 'code'>('diagram');
  const [zoom, setZoom] = useState<number>(1);

  useEffect(() => {
    if (!mermaidCode || mermaidCode.trim() === '') return;

    // Clean up code block tags (e.g. ```mermaid ... ```)
    const cleanCode = mermaidCode
      .replace(/^```mermaid\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      themeVariables: {
        darkMode: true,
        background: '#020617',
        primaryColor: '#0f172a',
        primaryTextColor: '#f8fafc',
        primaryBorderColor: '#6366f1',
        lineColor: '#10b981',
        textColor: '#e2e8f0',
        mainBkg: '#0b0f19',
        nodeBorder: '#334155',
        clusterBkg: '#090d16',
        clusterBorder: '#1e293b',
      },
      securityLevel: 'loose',
    });

    let isMounted = true;

    const renderGraph = async () => {
      try {
        setErrorMsg('');
        const id = `mermaid-svg-${Math.floor(Math.random() * 100000)}`;
        const { svg } = await mermaid.render(id, cleanCode);
        if (isMounted) {
          setSvgContent(svg);
        }
      } catch (err: any) {
        console.error('Mermaid render error:', err);
        if (isMounted) {
          setErrorMsg('Could not render topology graph. You can inspect the Mermaid definition below.');
        }
        // Cleanup leftover DOM elements injected by mermaid on syntax error
        const badElement = document.querySelector('svg[id^="mermaid-svg-"]');
        if (badElement) badElement.remove();
      }
    };

    renderGraph();

    return () => {
      isMounted = false;
    };
  }, [mermaidCode]);

  const copyCode = () => {
    navigator.clipboard.writeText(mermaidCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadSvg = () => {
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `repeated-answers-topology-${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800/90 rounded-2xl overflow-hidden shadow-sm">
      {/* Controls Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900/80 border-b border-slate-800 text-xs text-slate-300 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-200 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Topological Knowledge Map
          </span>
          <span className="text-[10px] text-slate-500 font-mono">Mermaid JS Engine</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          {viewMode === 'diagram' && (
            <div className="flex items-center bg-slate-800/80 rounded-lg p-0.5 border border-slate-700/60">
              <button
                onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))}
                className="p-1 hover:text-white transition"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="px-1.5 text-[10px] font-mono text-slate-400">{Math.round(zoom * 100)}%</span>
              <button
                onClick={() => setZoom((z) => Math.min(2.0, z + 0.15))}
                className="p-1 hover:text-white transition"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Toggle view mode */}
          <div className="flex bg-slate-800/80 rounded-lg p-0.5 border border-slate-700/60">
            <button
              onClick={() => setViewMode('diagram')}
              className={`px-2 py-1 rounded text-[11px] font-medium transition ${
                viewMode === 'diagram' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye className="w-3 h-3 inline mr-1" /> Diagram
            </button>
            <button
              onClick={() => setViewMode('code')}
              className={`px-2 py-1 rounded text-[11px] font-medium transition ${
                viewMode === 'code' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code className="w-3 h-3 inline mr-1" /> Mermaid
            </button>
          </div>

          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isGenerating}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition disabled:opacity-50"
              title="Regenerate Knowledge Map"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
          )}

          <button
            onClick={downloadSvg}
            disabled={!svgContent}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition disabled:opacity-50"
            title="Download Vector SVG"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={copyCode}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1 font-medium"
            title="Copy Mermaid Code"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Canvas / Code Body */}
      <div className="flex-1 overflow-auto p-4 min-h-[420px] max-h-[640px] flex items-center justify-center bg-slate-950/90 relative">
        {viewMode === 'code' ? (
          <pre className="w-full h-full p-4 font-mono text-xs text-emerald-400 bg-slate-900/90 rounded-xl overflow-auto border border-slate-800 whitespace-pre leading-relaxed">
            {mermaidCode}
          </pre>
        ) : errorMsg ? (
          <div className="p-6 text-center text-slate-400 max-w-md space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
            <p className="text-sm font-medium text-slate-200">{errorMsg}</p>
            <pre className="text-[11px] font-mono text-left bg-slate-900 p-3 rounded-lg overflow-x-auto text-slate-400">
              {mermaidCode}
            </pre>
          </div>
        ) : svgContent ? (
          <div
            ref={containerRef}
            className="transition-transform duration-150 origin-center select-none"
            style={{ transform: `scale(${zoom})` }}
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        ) : (
          <div className="text-center py-12 text-slate-500 text-xs flex flex-col items-center gap-2">
            <span className="w-3 h-3 rounded-full border-2 border-slate-600 border-t-emerald-400 animate-spin" />
            <span>Compiling topological concept network...</span>
          </div>
        )}
      </div>
    </div>
  );
}
