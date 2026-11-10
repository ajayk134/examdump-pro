import type { FastifyInstance } from 'fastify';
import { aiExplainSchema } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { forbidden, serviceUnavailable } from '../lib/errors.js';
import { getDatasetClient } from '../services/dataset.service.js';
import { isPremiumActive } from '../services/entitlement.service.js';
import { incrementUsage } from '../services/usage.service.js';

const DAILY_AI_LIMIT_PREMIUM = 200;

export async function aiRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.post('/explain', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(aiExplainSchema, request.body);

    if (!env.AI_API_KEY) {
      throw serviceUnavailable('AI assistance is not configured on this server.');
    }
    if (!isPremiumActive(user)) {
      throw forbidden('AI explanations are a Premium feature. Upgrade to unlock them.');
    }

    const { question, exam } = await getDatasetClient(env).getQuestion(
      input.provider,
      input.exam,
      input.questionId,
    );

    const choicesText = question.choices
      .map((c) => `${c.key}. ${c.text || (c.images.length ? '[image option]' : '')}`)
      .join('\n');

    const prompt = [
      'You are an expert certification exam tutor.',
      `Exam: ${exam.code}. Provider: ${exam.title}.`,
      `Question: ${question.stemText}`,
      choicesText ? `Choices:\n${choicesText}` : 'This is a drag-and-drop / visual question.',
      `Correct answer: ${question.answer || 'not provided'}.`,
      'Explain clearly why the correct answer is right and, when applicable, why the others are wrong.',
      'Use plain, conversational English in 2-4 short paragraphs. No markdown headings.',
    ].join('\n');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let explanation = '';
    try {
      const response = await fetch(`${env.AI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.AI_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.AI_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.4,
          max_tokens: 700,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw serviceUnavailable('The AI provider is temporarily unavailable.');
      }
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      explanation = data.choices?.[0]?.message?.content?.trim() ?? '';
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw serviceUnavailable('The AI request timed out. Please try again.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!explanation) throw serviceUnavailable('The AI provider returned an empty response.');

    await incrementUsage(user._id, 'aiExplanations', 1);
    return reply.send({
      explanation,
      model: env.AI_MODEL,
      dailyLimit: DAILY_AI_LIMIT_PREMIUM,
    });
  });
}