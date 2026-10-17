/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FALLBACK_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-4-argon',
  'gemini-3.1-pro-preview'
];

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const apiKey = process.env.GEMINI_API_KEY;
  const ai = new GoogleGenAI({
    apiKey: apiKey || 'dummy-key',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  // API Routes
  app.post('/api/check-model', async (req, res) => {
    try {
      const { model } = req.body;
      if (!apiKey) {
        return res.status(400).json({ error: 'GEMINI_API_KEY environment variable is missing.' });
      }
      const testModel = model || 'gemini-3.5-flash';
      const response = await ai.models.generateContent({
        model: testModel,
        contents: 'Hello',
        config: { maxOutputTokens: 10 },
      });
      return res.json({ success: true, text: response.text });
    } catch (err: any) {
      console.error('Model check error:', err);
      const status = err?.status || 500;
      return res.status(status).json({ error: err?.message || 'Model check failed' });
    }
  });

  app.post('/api/generate', async (req, res) => {
    try {
      const { model, prompt, question, shape, recentAnswers, highThinking } = req.body;
      const requestedModel = model || 'gemini-3.5-flash';

      let shapeInstruction = '';
      if (shape === 'short') shapeInstruction = 'Provide a short, punchy answer in 1-2 sentences.';
      else if (shape === 'note') shapeInstruction = 'Provide a concise paragraph answer.';
      else if (shape === 'list') shapeInstruction = 'Provide exactly 3 distinct bullet points.';

      const avoidListStr = recentAnswers && recentAnswers.length > 0
        ? `\n\nCRITICAL: Do NOT repeat these recently stated points/answers:\n- ${recentAnswers.slice(-15).join('\n- ')}`
        : '';

      const fullPrompt = `${question}\n\n${shapeInstruction}${avoidListStr}\n\nMake sure this response brings up a fresh angle or distinct point not covered in the avoid list.`;

      const config: any = {};
      if (highThinking) {
        config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
      } else {
        config.maxOutputTokens = 1024;
        config.temperature = 1.0;
      }

      const modelsToTry = [requestedModel, ...FALLBACK_MODELS.filter(m => m !== requestedModel)];
      let response: any = null;
      let lastError: any = null;

      for (const tryModel of modelsToTry) {
        try {
          response = await ai.models.generateContent({
            model: tryModel,
            contents: fullPrompt,
            config,
          });

          // Handle empty MAX_TOKENS response retry if needed
          if ((!response.text || response.text.trim() === '') && response.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
            const retryConfig = { ...config, maxOutputTokens: 2048 };
            delete retryConfig.thinkingConfig;
            response = await ai.models.generateContent({
              model: tryModel,
              contents: fullPrompt,
              config: retryConfig,
            });
          }

          if (response && response.text) {
            break;
          }
        } catch (err: any) {
          lastError = err;
          const status = err.status || err.code || 500;
          if (status === 429 || status === 503 || err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
            console.warn(`Model ${tryModel} hit rate limit/quota (429), trying fallback model...`);
            continue;
          } else {
            throw err;
          }
        }
      }

      if (!response || !response.text) {
        throw lastError || new Error('All Gemini fallback models exhausted quota limits.');
      }

      const text = response.text || '';
      return res.json({ text, finishReason: response.candidates?.[0]?.finishReason });
    } catch (err: any) {
      console.error('Generation error:', err);
      const status = err?.status || err?.code || 500;
      return res.status(status === 429 ? 429 : 500).json({ error: err?.message || 'Generation failed', status });
    }
  });

  app.post('/api/embed', async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) {
        return res.status(400).json({ error: 'Text required for embedding' });
      }
      const response = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: text,
        config: {
          outputDimensionality: 768,
          taskType: 'SEMANTIC_SIMILARITY' as any,
        },
      });
      const embedding = response.embeddings?.[0]?.values || [];
      return res.json({ embedding });
    } catch (err: any) {
      console.error('Embedding error:', err);
      const status = err?.status || 500;
      return res.status(status).json({ error: err?.message || 'Embedding failed' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Repeated Answers Studio server running on http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
