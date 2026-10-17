/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { MODELS } from './src/lib/studio/types.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fix 4: Default fallback list as server-side constant: gemini-3.5-flash-lite, then gemini-3.5-flash.
// Remove gemini-4-argon and gemini-3.1-pro-preview from default fallback.
const DEFAULT_FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash'];

// Simple in-memory rate limiter per IP: 30 requests per minute
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
function rateLimitMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxReqs = 30;

  let record = rateLimitMap.get(ip);
  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + windowMs };
    rateLimitMap.set(ip, record);
  } else {
    record.count++;
  }

  if (record.count > maxReqs) {
    return res.status(429).json({ error: 'Rate limit exceeded (30 requests per minute max).' });
  }
  next();
}

// Fix 2: APP_ACCESS_TOKEN middleware
function accessTokenMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const expectedToken = process.env.APP_ACCESS_TOKEN;
  if (expectedToken && expectedToken.trim() !== '') {
    const clientToken = req.headers['x-access-token'];
    if (clientToken !== expectedToken) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing x-access-token header.' });
    }
  }
  next();
}

// Fix 2: Input validation middleware for generate
function validateGenerateInput(req: express.Request, res: express.Response, next: express.NextFunction) {
  const { model, question, shape, recentAnswers } = req.body;

  const modelToTest = model || 'gemini-3.5-flash';
  if (!MODELS.includes(modelToTest)) {
    return res.status(400).json({ error: `Invalid or unlisted model: ${modelToTest}` });
  }

  if (typeof question !== 'string' || question.trim() === '' || question.length > 2000) {
    return res.status(400).json({ error: 'Question must be a string between 1 and 2000 characters.' });
  }

  if (!['short', 'note', 'list'].includes(shape)) {
    return res.status(400).json({ error: "Shape must be 'short', 'note', or 'list'." });
  }

  if (recentAnswers !== undefined) {
    if (!Array.isArray(recentAnswers) || recentAnswers.length > 50) {
      return res.status(400).json({ error: 'recentAnswers must be an array with at most 50 items.' });
    }
    for (const ans of recentAnswers) {
      if (typeof ans !== 'string' || ans.length > 2000) {
        return res.status(400).json({ error: 'Each recent answer must be a string of at most 2000 characters.' });
      }
    }
  }

  next();
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Apply access token check and rate limiting to all /api routes
  app.use('/api', accessTokenMiddleware);

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
  app.post('/api/check-model', rateLimitMiddleware, async (req, res) => {
    try {
      const { model } = req.body;
      const testModel = model || 'gemini-3.5-flash';
      if (!MODELS.includes(testModel)) {
        return res.status(400).json({ error: `Invalid or unlisted model: ${testModel}` });
      }
      if (!apiKey) {
        return res.status(400).json({ error: 'GEMINI_API_KEY environment variable is missing.' });
      }
      const response = await ai.models.generateContent({
        model: testModel,
        contents: 'Hello',
        config: { maxOutputTokens: 10 },
      });
      return res.json({ success: true, text: response.text });
    } catch (err: any) {
      console.error('Model check error:', err);
      const status = err?.status || err?.code || 500;
      return res.status(status).json({ error: err?.message || 'Model check failed' });
    }
  });

  app.post('/api/generate', rateLimitMiddleware, validateGenerateInput, async (req, res) => {
    try {
      const { model, question, shape, recentAnswers, highThinking } = req.body;
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
        // Fix 2: Keep thinkingConfig with thinkingLevel HIGH, set maxOutputTokens to 8192, do not send thinkingBudget
        config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
        config.maxOutputTokens = 8192;
      } else {
        config.maxOutputTokens = 1024;
        config.temperature = 1.0;
      }

      // Fix 4: Chain starts with user-selected model, followed by default fallbacks (deduplicated)
      const modelsToTry = [requestedModel, ...DEFAULT_FALLBACK_MODELS.filter(m => m !== requestedModel)];
      let response: any = null;
      let usedModel = requestedModel;
      let fallbackUsed = false;
      let lastError: any = null;

      for (let i = 0; i < modelsToTry.length; i++) {
        const tryModel = modelsToTry[i];
        try {
          usedModel = tryModel;
          fallbackUsed = i > 0;

          response = await ai.models.generateContent({
            model: tryModel,
            contents: fullPrompt,
            config,
          });

          // Fix 4: Do not switch models for an empty response. Retry once on the same model with maxOutputTokens 2048.
          if ((!response.text || response.text.trim() === '') && response.candidates?.[0]?.finishReason) {
            const finishReason = response.candidates[0].finishReason;
            if (finishReason !== 'STOP') {
              // Return error naming the finishReason (e.g. SAFETY, MAX_TOKENS)
              return res.status(422).json({
                error: `Model returned empty response with finishReason: ${finishReason}`,
                finishReason,
                modelUsed: tryModel
              });
            }

            // Retry once on the same model with maxOutputTokens 2048
            const retryConfig = { ...config, maxOutputTokens: 2048 };
            response = await ai.models.generateContent({
              model: tryModel,
              contents: fullPrompt,
              config: retryConfig,
            });

            if (!response.text || response.text.trim() === '') {
              const secondReason = response.candidates?.[0]?.finishReason || 'EMPTY';
              return res.status(422).json({
                error: `Model returned empty response after retry (finishReason: ${secondReason})`,
                finishReason: secondReason,
                modelUsed: tryModel
              });
            }
          }

          if (response && response.text && response.text.trim() !== '') {
            break;
          }
        } catch (err: any) {
          lastError = err;
          const status = err.status || err.code || 500;
          const errMsg = (err.message || '').toLowerCase();

          // Fix 4: Stop immediately on invalid API key errors (401/403 auth) and on 400 client errors.
          // Continue on 429, 503, and on 403 or 404 responses that refer to model availability.
          const isInvalidKey = status === 401 || errMsg.includes('api key') || errMsg.includes('unauthorized') || errMsg.includes('invalid credentials');
          const isBadRequest = status === 400 && !errMsg.includes('model') && !errMsg.includes('quota');

          if (isInvalidKey || isBadRequest) {
            throw err;
          }

          const isAvailabilityError = status === 429 || status === 503 || status === 403 || status === 404 || errMsg.includes('429') || errMsg.includes('503') || errMsg.includes('resource_exhausted') || errMsg.includes('not found') || errMsg.includes('unavailable');

          if (isAvailabilityError && i < modelsToTry.length - 1) {
            console.warn(`Model ${tryModel} encountered availability/quota error (${status}), falling back to next model...`);
            continue;
          } else {
            throw err;
          }
        }
      }

      if (!response || !response.text || response.text.trim() === '') {
        throw lastError || new Error('All fallback models exhausted or returned empty content.');
      }

      const text = response.text || '';
      return res.json({
        text,
        finishReason: response.candidates?.[0]?.finishReason,
        modelUsed: usedModel,
        fallbackUsed,
      });
    } catch (err: any) {
      console.error('Generation error:', err);
      const status = err?.status || err?.code || 500;
      return res.status(status >= 400 && status < 600 ? status : 500).json({ error: err?.message || 'Generation failed', status });
    }
  });

  app.post('/api/novelty-judge', rateLimitMiddleware, async (req, res) => {
    try {
      const { candidate, closestKept, model } = req.body;
      const prompt = `You are a strict novelty judge for research insights.

Candidate answer:
"""
${candidate}
"""

Closest existing answers:
${closestKept.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')}

Does the candidate introduce a GENUINELY DISTINCT insight (new claim, new mechanism, new consequence, new trade-off), or is it essentially a rephrasing / minor variation of one of the existing answers?

Reply with ONLY valid JSON:
{
  "isNovel": true or false,
  "reason": "one short sentence explaining the decision"
}`;

      const response = await ai.models.generateContent({
        model: model || 'gemini-3.5-flash-lite',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: 200,
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      return res.json({
        isNovel: Boolean(parsed.isNovel),
        reason: parsed.reason || 'No reason given',
      });
    } catch (err: any) {
      console.error('Novelty judge error:', err);
      res.json({ isNovel: true, reason: 'Judge failed – defaulting to novel' });
    }
  });

  app.post('/api/embed', rateLimitMiddleware, async (req, res) => {
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
