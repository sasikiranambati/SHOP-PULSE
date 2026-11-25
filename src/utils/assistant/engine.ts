/**
 * Business assistant pipeline: question -> intent -> (role check) -> data -> formatted answer.
 *
 * - Unknown or ambiguous questions fetch nothing.
 * - Roles without analytics access get a restricted answer without a request; the backend remains the
 *   authority (a 403 from it is shown the same way).
 * - Any failure becomes an error answer. There is no fallback data path.
 */
import { fetchForIntent, classifyAssistantError, type InsightsSource } from './data';
import { clarifyAnswer, formatAnswer, formatError, helpAnswer, restrictedAnswer } from './format';
import { detectIntent } from './intents';
import type { AssistantAnswer, AssistantIntent } from './types';

export interface AnswerContext {
  /** True for OWNER/MANAGER. */
  canAccessAnalytics: boolean;
  api?: InsightsSource;
}

export async function answerIntent(intent: AssistantIntent, ctx: AnswerContext): Promise<AssistantAnswer> {
  if (intent.category === 'UNKNOWN') {
    if (intent.reason === 'ambiguous' && intent.options?.length) {
      return ctx.canAccessAnalytics ? clarifyAnswer(intent.options) : restrictedAnswer();
    }
    return ctx.canAccessAnalytics ? helpAnswer() : restrictedAnswer();
  }
  if (!ctx.canAccessAnalytics) return restrictedAnswer();

  const source = intent.category === 'SALES' ? 'sales' : intent.category === 'INVENTORY' ? 'inventory' : intent.category === 'FORECAST' ? 'forecast' : 'summary';
  try {
    const data = ctx.api ? await fetchForIntent(intent, ctx.api) : await fetchForIntent(intent);
    return formatAnswer(intent, data);
  } catch (err) {
    return formatError(classifyAssistantError(err, source));
  }
}

export async function answerQuestion(question: string, ctx: AnswerContext): Promise<{ intent: AssistantIntent; answer: AssistantAnswer }> {
  const intent = detectIntent(question);
  return { intent, answer: await answerIntent(intent, ctx) };
}
