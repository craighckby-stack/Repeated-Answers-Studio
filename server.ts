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
import { MODELS } from './src/lib/studio/types.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash'];

// Rate limiter with configurable RATE_LIMIT_PER_MINUTE (default 60) and minute cleanup
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const rateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 60 * 1000);
if (rateLimitCleanupInterval.unref) {
  rateLimitCleanupInterval.unref();
}

function rateLimitMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000;
  const configuredLimit = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60', 10);
  const maxReqs = isNaN(configuredLimit) ? 60 : configuredLimit;

  let record = rateLimitMap.get(ip);
  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + windowMs };
    rateLimitMap.set(ip, record);
  } else {
    record.count++;
  }

  if (record.count > maxReqs) {
    return res.status(429).json({ error: `Rate limit exceeded (${maxReqs} requests per minute max).` });
  }
  next();
}

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

function validateGenerateInput(req: express.Request, res: express.Response, next: express.NextFunction) {
  const { model, question, shape, recentAnswers, recentIdeas } = req.body;

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

  if (recentIdeas !== undefined) {
    if (!Array.isArray(recentIdeas) || recentIdeas.length > 30) {
      return res.status(400).json({ error: 'recentIdeas must be an array with at most 30 items.' });
    }
    for (const idea of recentIdeas) {
      if (typeof idea !== 'string' || idea.length > 2000) {
        return res.status(400).json({ error: 'Each recent idea must be a string of at most 2000 characters.' });
      }
    }
  }

  const { abstraction } = req.body;
  if (abstraction !== undefined && !['concrete', 'balanced', 'abstract'].includes(abstraction)) {
    return res.status(400).json({ error: "Abstraction must be 'concrete', 'balanced', or 'abstract'." });
  }

  next();
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  if (process.env.TRUST_PROXY) {
    const tp = process.env.TRUST_PROXY;
    if (tp === 'true') app.set('trust proxy', true);
    else if (tp === 'false') app.set('trust proxy', false);
    else if (!isNaN(Number(tp))) app.set('trust proxy', Number(tp));
    else app.set('trust proxy', tp);
  }

  app.use('/api', rateLimitMiddleware);
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

  app.post('/api/check-model', async (req, res) => {
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

  app.post('/api/generate', validateGenerateInput, async (req, res) => {
    try {
      const { model, question, shape, recentAnswers, recentIdeas, highThinking, abstraction } = req.body;
      const requestedModel = model || 'gemini-3.5-flash';

      let shapeInstruction = '';
      if (shape === 'short') shapeInstruction = 'Provide a short, punchy answer in 1-2 sentences.';
      else if (shape === 'note') shapeInstruction = 'Provide a concise paragraph answer.';
      else if (shape === 'list') shapeInstruction = 'Provide exactly 3 distinct bullet points.';

      let abstractionInstruction = '';
      if (abstraction === 'concrete') {
        abstractionInstruction = 'State the idea in terms of specific mechanisms and measurable quantities.';
      } else if (abstraction === 'abstract') {
        abstractionInstruction = 'Work at the level of general principles and cross-domain mechanisms. Abstraction is encouraged, but the principle must still imply a specific observable consequence.';
      } else {
        abstractionInstruction = 'State the idea at a moderate level of generality, with at least one named mechanism.';
      }
      abstractionInstruction += " Frame the answer as a hypothesis, saying 'if X, then Y' where possible. Do not present it as established.";

      const avoidListStr = recentAnswers && recentAnswers.length > 0
        ? `\n\nCRITICAL: Do NOT repeat these recently stated points/answers:\n- ${recentAnswers.slice(-15).join('\n- ')}`
        : '';

      const avoidIdeasStr = recentIdeas && recentIdeas.length > 0
        ? `\n\nDo not reuse any of these core ideas: ${recentIdeas.slice(-30).join(', ')}.`
        : '';

      const fullPrompt = `${question}\n\n${shapeInstruction}\n${abstractionInstruction}${avoidListStr}${avoidIdeasStr}\n\ncoreIdea is a 4 to 8 word label for the specific argument, method, or framework your answer uses. Make sure this response brings up a fresh angle or distinct point not covered in the avoid list.\n\nRequired fields at every abstraction level:\n- observableConsequence: One specific prediction that follows if this answer is right. Name what would be measured and roughly where or when.\n- counterevidence: One specific observation or result that would count against this answer. Do not write 'none', 'unknown', or 'not applicable'.\nBoth observableConsequence and counterevidence are strictly required.`;

      const config: any = {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            answer: { type: Type.STRING, description: 'The generated prose response.' },
            coreIdea: { type: Type.STRING, description: 'A 4 to 8 word label for the specific argument, method, or framework used.' },
            observableConsequence: {
              type: Type.STRING,
              description: 'One specific prediction that follows if this answer is right. Name what would be measured and roughly where or when.',
            },
            counterevidence: {
              type: Type.STRING,
              description: 'One specific observation or result that would count against this answer. Do not write \'none\', \'unknown\', or \'not applicable\'.',
            },
          },
          required: ['answer', 'coreIdea', 'observableConsequence', 'counterevidence'],
        },
      };

      if (highThinking) {
        config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
        config.maxOutputTokens = 8192;
      } else {
        config.maxOutputTokens = 1024;
        config.temperature = 1.0;
      }

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

          let parsed: any = null;
          try {
            parsed = JSON.parse(response.text || '{}');
          } catch {}

          const isMalformed = (p: any) =>
            !p ||
            typeof p.answer !== 'string' ||
            typeof p.coreIdea !== 'string' ||
            typeof p.observableConsequence !== 'string' ||
            typeof p.counterevidence !== 'string';

          if (isMalformed(parsed)) {
            const retryConfig = { ...config, maxOutputTokens: 2048 };
            try {
              const retryResponse = await ai.models.generateContent({
                model: tryModel,
                contents: fullPrompt,
                config: retryConfig,
              });
              parsed = JSON.parse(retryResponse.text || '{}');
              response = retryResponse;
            } catch {}
          }

          if (isMalformed(parsed)) {
            const finishReason = response?.candidates?.[0]?.finishReason || 'UNKNOWN';
            return res.status(500).json({ error: `Malformed model output (finishReason ${finishReason})` });
          }

          return res.json({
            text: parsed.answer,
            coreIdea: parsed.coreIdea,
            observableConsequence: parsed.observableConsequence,
            counterevidence: parsed.counterevidence,
            finishReason: response.candidates?.[0]?.finishReason,
            modelUsed: usedModel,
            fallbackUsed,
          });
        } catch (err: any) {
          lastError = err;
          const status = err.status || err.code || 500;
          const errMsg = (err.message || '').toLowerCase();

          const isInvalidKey = status === 401 || errMsg.includes('api key') || errMsg.includes('unauthorized') || errMsg.includes('invalid credentials');
          const isBadRequest = status === 400 && !errMsg.includes('model') && !errMsg.includes('quota');

          if (isInvalidKey || isBadRequest) {
            throw err;
          }

          const isAvailabilityError = status === 429 || status === 503 || status === 403 || status === 404 || errMsg.includes('429') || errMsg.includes('503') || errMsg.includes('resource_exhausted') || errMsg.includes('not found') || errMsg.includes('unavailable') || errMsg.includes('quota');

          if (isAvailabilityError && i < modelsToTry.length - 1) {
            continue;
          } else {
            throw err;
          }
        }
      }

      if (!response || !response.text) {
        throw lastError || new Error('All fallback models exhausted or returned empty content.');
      }

      const parsed = JSON.parse(response.text || '{}');
      return res.json({
        text: parsed.answer || response.text,
        coreIdea: parsed.coreIdea || 'General perspective',
        observableConsequence: parsed.observableConsequence || '',
        counterevidence: parsed.counterevidence || '',
        finishReason: response.candidates?.[0]?.finishReason,
        modelUsed: usedModel,
        fallbackUsed,
      });
    } catch (err: any) {
      console.error('Generation error:', err);
      let status = err?.status || err?.code || 500;
      const errMsg = (err?.message || '').toLowerCase();
      if ((status === 500 || isNaN(status)) && (errMsg.includes('429') || errMsg.includes('resource_exhausted') || errMsg.includes('quota') || errMsg.includes('rate limit'))) {
        status = 429;
      }
      return res.status(status >= 400 && status < 600 ? status : 500).json({ error: err?.message || 'Generation failed', status });
    }
  });

  app.post('/api/novelty-judge', async (req, res) => {
    try {
      const { candidate, closestKept, candidateCore } = req.body;

      if (typeof candidate !== 'string' || candidate.length > 4000) {
        return res.status(400).json({ error: 'candidate must be a string of at most 4000 characters.' });
      }
      if (candidateCore !== undefined && (typeof candidateCore !== 'string' || candidateCore.length > 300)) {
        return res.status(400).json({ error: 'candidateCore must be a string of at most 300 characters.' });
      }
      if (!Array.isArray(closestKept) || closestKept.length > 8) {
        return res.status(400).json({ error: 'closestKept must be an array of at most 8 strings.' });
      }
      for (const k of closestKept) {
        if (typeof k !== 'string' || k.length > 300) {
          return res.status(400).json({ error: 'Each kept item must be a string of at most 300 characters.' });
        }
      }

      const prompt = `You are a strict conceptual novelty judge for research insights.

Candidate core idea:
"${candidateCore || 'not provided'}"

Full candidate:
"""
${candidate}
"""

Previously accepted core ideas:
${closestKept.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n')}

Decide: Does the candidate introduce a genuinely new conceptual claim, mechanism, or perspective, or is it the same underlying idea expressed through a different formal system, vocabulary, or framing?

Treat as SAME idea when:
- Different formal systems or vocabularies all expressing the identical underlying claim or relationship
- Different lenses that still make the identical substantive point
- Rephrasing or minor elaboration of an already-kept point

Reply ONLY with valid JSON:
{
  "isNovel": true or false,
  "reason": "one clear sentence"
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
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
      return res.status(503).json({ error: 'LLM judge unavailable' });
    }
  });

  app.post('/api/embed', async (req, res) => {
    try {
      const { texts } = req.body;
      if (!texts || !Array.isArray(texts) || texts.length === 0 || texts.length > 4) {
        return res.status(400).json({ error: 'texts must be an array of 1 to 4 strings.' });
      }
      for (const t of texts) {
        if (typeof t !== 'string' || t.length > 2000) {
          return res.status(400).json({ error: 'Each text must be a string of at most 2000 characters.' });
        }
      }

      const response = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: texts,
        config: {
          outputDimensionality: 768,
          taskType: 'SEMANTIC_SIMILARITY' as any,
        },
      });

      const embeddings = (response.embeddings || []).map((e: any) => e.values || []);
      return res.json({ embeddings });
    } catch (err: any) {
      console.error('Embedding error:', err);
      const status = err?.status || 500;
      return res.status(status).json({ error: err?.message || 'Embedding failed' });
    }
  });

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
