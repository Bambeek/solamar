// AI engines behind Solamar's own features, chosen per feature in Settings:
//   claude-code - the user's own Claude Code CLI on their Claude plan (personal builds only)
//   ollama      - a local model on this computer
//   anthropic   - Claude through the user's own API key (never a claude.ai login)
import Anthropic from '@anthropic-ai/sdk'
import { app } from 'electron'
import type { AiFeature, AiSettings, EngineId } from '@shared/types'
import { claudeCodeStream } from './claude-cli'
import { ollamaChat, ollamaModels, type ChatMessage } from './ai'

export interface RunOptions {
  signal: AbortSignal
  json?: boolean
  fast?: boolean // short, latency-sensitive jobs (write, search)
}

export interface Engine {
  id: EngineId
  label: string
  stream(messages: ChatMessage[], opts: RunOptions): AsyncGenerator<string>
}

export class RefusalError extends Error {}

export function engineFor(settings: AiSettings, feature: AiFeature): EngineId {
  return settings.features[feature] ?? settings.engine
}

export function ollamaEngine(settings: AiSettings): Engine {
  return {
    id: 'ollama',
    label: `Local · ${settings.model || 'no model'}`,
    stream: (messages, opts) => ollamaChat(settings.host, settings.model, messages, opts.signal, opts.json)
  }
}

/**
 * Running Solamar's features on the user's Claude plan (through their own Claude Code CLI) is for personal builds.
 * Anthropic does not allow third-party products to offer Claude plan usage, so packaged public builds hide it
 * unless SOLAMAR_PERSONAL=1 is set by the user themselves.
 */
export function claudeCodeEngineAllowed(): boolean {
  return !app.isPackaged || (typeof __SOLAMAR_PERSONAL__ !== 'undefined' && __SOLAMAR_PERSONAL__) || process.env.SOLAMAR_PERSONAL === '1'
}

export function claudeCodeEngine(model: string): Engine {
  return {
    id: 'claude-code',
    label: 'Claude Code (your plan)',
    async *stream(messages, opts) {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
      const turns = messages.filter((m) => m.role !== 'system')
      const last = turns[turns.length - 1]?.content ?? ''
      const earlier = turns.slice(0, -1).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      const prompt = (earlier.length ? `Conversation so far:\n${earlier.join('\n\n')}\n\nUser: ` : '') + last + (opts.json ? '\n\nReply with JSON only.' : '')
      yield* claudeCodeStream(system, prompt, { signal: opts.signal, model: model || undefined })
    }
  }
}

// Models that accept server-side refusal fallbacks (Claude Haiku 5.5 has none).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5'])

// Pinned so an inherited ANTHROPIC_BASE_URL (e.g. Solamar started from a dev terminal) can never redirect the user's key.
const ANTHROPIC_API = 'https://api.anthropic.com'

export function anthropicClient(apiKey: string, baseURL = ANTHROPIC_API): Anthropic {
  return new Anthropic({ apiKey, baseURL })
}

export function anthropicEngine(apiKey: string, model: string, baseURL = ANTHROPIC_API): Engine {
  const client = anthropicClient(apiKey, baseURL)
  return {
    id: 'anthropic',
    label: model,
    async *stream(messages, opts) {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
      const turns = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: 16000,
          ...(system ? { system } : {}),
          messages: turns,
          output_config: { effort: opts.fast ? 'low' : 'medium' },
          ...(FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
        },
        { signal: opts.signal }
      )
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text
      }
      const final = await stream.finalMessage()
      if (final.stop_reason === 'refusal') throw new RefusalError('Claude declined this request.')
    }
  }
}

/** Cheap key check: lists models, spends no tokens. */
export async function checkAnthropicKey(apiKey: string, baseURL = ANTHROPIC_API): Promise<void> {
  const client = new Anthropic({ apiKey, baseURL, maxRetries: 0, timeout: 10_000 })
  await client.models.list({ limit: 1 })
}

export async function ollamaStatus(settings: AiSettings): Promise<string[]> {
  return ollamaModels(settings.host)
}

/** A short, human message for an engine error (never echoes the key). */
export function describeEngineError(err: unknown, engine: EngineId): string {
  if (err instanceof RefusalError) return err.message
  if (err instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Check it in Settings > Local AI.'
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key has no access to the chosen model.'
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic rate limit reached. Try again in a moment.'
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API. Check your connection.'
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ''}`.trim()
  const msg = err instanceof Error ? err.message : String(err)
  return engine === 'ollama' && /fetch failed|ECONNREFUSED/i.test(msg) ? 'Ollama is not running on this computer.' : msg
}
