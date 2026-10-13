import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Logger } from '@/lib/utils/log';
import { EditorialDraftSchema, packToUserMessage, SYSTEM_PROMPT, type AiProvider, type EditorialDraft, type EvidencePack } from './types';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

/** Minimal surface we use, so tests can pass a stub instead of a network client. */
export interface AnthropicLike {
  messages: { parse: (params: never) => Promise<{ stop_reason: string | null; parsed_output: unknown }> };
}

export function anthropicProvider(opts: { apiKey?: string; model?: string; client?: AnthropicLike; log: Logger }): AiProvider {
  const model = opts.model || DEFAULT_ANTHROPIC_MODEL;
  const client = opts.client ?? (new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 60_000 }) as unknown as AnthropicLike);
  return {
    name: 'anthropic',
    model,
    async summarize(pack: EvidencePack): Promise<EditorialDraft | null> {
      try {
        const response = await client.messages.parse({
          model,
          max_tokens: 4000,
          system: SYSTEM_PROMPT,
          thinking: { type: 'adaptive' },
          // Summarising a small evidence pack is routine work; `low` keeps cost down.
          output_config: { effort: 'low', format: zodOutputFormat(EditorialDraftSchema) },
          messages: [{ role: 'user', content: packToUserMessage(pack) }],
        } as never);
        // A refusal or truncated response is not an error: fall back to the extractive summary.
        if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
          opts.log.warn('anthropic declined or truncated', { id: pack.id, stop: response.stop_reason });
          return null;
        }
        const parsed = EditorialDraftSchema.safeParse(response.parsed_output);
        return parsed.success ? parsed.data : null;
      } catch (err) {
        if (err instanceof Anthropic.RateLimitError) opts.log.warn('anthropic rate limited', { id: pack.id });
        else if (err instanceof Anthropic.AuthenticationError) opts.log.error('anthropic authentication failed');
        else if (err instanceof Anthropic.APIError) opts.log.warn('anthropic api error', { id: pack.id, status: err.status });
        else opts.log.warn('anthropic request failed', { id: pack.id, error: (err as Error).message });
        return null;
      }
    },
  };
}
