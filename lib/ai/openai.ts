import { z } from 'zod';
import { request, type HttpOptions } from '@/lib/utils/http';
import type { Logger } from '@/lib/utils/log';
import { EditorialDraftSchema, packToUserMessage, SYSTEM_PROMPT, type AiProvider, type EditorialDraft, type EvidencePack } from './types';

/**
 * OpenAI-compatible provider over plain HTTP (chat completions with a strict
 * JSON schema). The model name is required: there is no default to go stale.
 */
export function openaiProvider(opts: { apiKey: string; model: string; baseUrl?: string; http?: HttpOptions; log: Logger }): AiProvider {
  const schema = z.toJSONSchema(EditorialDraftSchema) as Record<string, unknown>;
  delete schema.$schema;
  return {
    name: 'openai',
    model: opts.model,
    async summarize(pack: EvidencePack): Promise<EditorialDraft | null> {
      try {
        const res = await request(`${opts.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`, {
          ...opts.http,
          method: 'POST',
          timeoutMs: 60_000,
          retries: 2,
          headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: opts.model,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: packToUserMessage(pack) },
            ],
            response_format: { type: 'json_schema', json_schema: { name: 'editorial_note', strict: true, schema } },
          }),
        });
        const body = JSON.parse(res.text) as { choices?: { message?: { content?: string; refusal?: string } }[] };
        const message = body.choices?.[0]?.message;
        if (!message?.content || message.refusal) return null;
        const parsed = EditorialDraftSchema.safeParse(JSON.parse(message.content));
        return parsed.success ? parsed.data : null;
      } catch (err) {
        opts.log.warn('openai request failed', { id: pack.id, error: (err as Error).message });
        return null;
      }
    },
  };
}
