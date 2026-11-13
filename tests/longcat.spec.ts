import { describe, it, expect, vi } from 'vitest'
import { createLongcatClient } from '../src/longcat.ts'
import type { CatalogEntry } from '../src/contracts.ts'

const FAKE_KEY = 'pt-probe-fake-key-DO-NOT-LEAK'

const MODELS_BODY = {
  object: 'list',
  data: [{ id: 'LongCat-2.5', object: 'model', owned_by: 'LongCat' }],
}

const DETAIL_BODY = {
  id: 'LongCat-2.5',
  name: 'LongCat-2.5',
  created: 1773331200,
  context_length: 1048576,
  architecture: {
    input_modalities: ['text'],
    output_modalities: ['text'],
    modality: 'text->text',
    tokenizer: 'Other',
    instruct_type: null,
  },
  supported_parameters: [
    'max_tokens',
    'temperature',
    'top_p',
    'stream',
    'tools',
    'tool_choice',
    'thinking',
  ],
  pricing: { prompt: '2', completion: '8', cached_tokens: '0.04' },
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type CallRecord = { url: string; init: Record<string, unknown> }

/** Inject a fetch mock; no real network is touched. */
function makeFetch(handler: (url: string) => Response) {
  const calls: CallRecord[] = []
  const fn = vi.fn(async (input: unknown, init?: unknown): Promise<Response> => {
    const record = (init && typeof init === 'object' ? init : {}) as Record<string, unknown>
    const url = String(input)
    calls.push({ url, init: record })
    return handler(url)
  })
  return { fn, calls }
}

const liveFetch = (url: string): Response =>
  url.endsWith('/v1/models') ? jsonResponse(MODELS_BODY) : jsonResponse(DETAIL_BODY)

describe('createLongcatClient (channel A)', () => {
  // ① GET /v1/models is parsed and each id is prefixed with longcat/.
  it('① parses /v1/models and adds the longcat/ prefix', async () => {
    const { fn, calls } = makeFetch(liveFetch)
    const client = createLongcatClient({ apiKey: FAKE_KEY, fetchFn: fn })
    const entries: CatalogEntry[] = await client.listModels()
    expect(calls[0]!.url.endsWith('/v1/models')).toBe(true)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.id).toBe('longcat/LongCat-2.5')
    expect(entries[0]!.provider).toBe('longcat')
  })

  // ② A detail GET is actually issued for every id in the list.
  it('② calls /v1/models/{model} for every id', async () => {
    const { fn, calls } = makeFetch(liveFetch)
    const client = createLongcatClient({ apiKey: FAKE_KEY, fetchFn: fn })
    await client.listModels()
    expect(calls.some((c) => c.url.endsWith('/v1/models/LongCat-2.5'))).toBe(true)
  })

  // ③ Live detail fields are synthesized correctly and marked live.
  it('③ synthesizes context_length / supported_parameters / pricing with detailSource live', async () => {
    const { fn } = makeFetch(liveFetch)
    const client = createLongcatClient({ apiKey: FAKE_KEY, fetchFn: fn })
    const entries = await client.listModels()
    const entry: CatalogEntry = entries[0]!
    expect(entry.contextWindow).toBe(1048576)
    expect(entry.maxTokens).toBe(262144)
    expect(entry.supportedParameters).toEqual([
      'max_tokens',
      'temperature',
      'top_p',
      'stream',
      'tools',
      'tool_choice',
      'thinking',
    ])
    expect(entry.pricing).toEqual({ prompt: '2', completion: '8', cached_tokens: '0.04' })
    expect(entry.detailSource).toBe('live')
    expect(entry.contextTiers).toBeUndefined()
    expect(entry.contextTier).toBeUndefined()
  })

  // ④ A 401 on the list or on a detail falls back to the static catalog, no throw.
  it('④ falls back to LONGCAT_CATALOG_FALLBACK on list 401 or detail 401 without throwing', async () => {
    const list401 = makeFetch(() => jsonResponse({ error: 'unauthorized' }, 401))
    const clientA = createLongcatClient({ apiKey: FAKE_KEY, fetchFn: list401.fn })
    await expect(clientA.listModels()).resolves.toBeInstanceOf(Array)
    const a = await clientA.listModels()
    expect(a.length).toBeGreaterThan(0)
    expect(a.every((e) => e.detailSource === 'fallback')).toBe(true)
    expect(a[0]!.id).toBe('longcat/LongCat-2.5')
    expect(a[0]!.contextWindow).toBe(1048576)
    expect(a[0]!.maxTokens).toBe(262144)

    const detail401 = makeFetch((url) =>
      url.endsWith('/v1/models') ? jsonResponse(MODELS_BODY) : jsonResponse({ error: 'unauthorized' }, 401),
    )
    const clientB = createLongcatClient({ apiKey: FAKE_KEY, fetchFn: detail401.fn })
    const b = await clientB.listModels()
    expect(b.length).toBeGreaterThan(0)
    expect(b.every((e) => e.detailSource === 'fallback')).toBe(true)
  })

  // ⑤ Modal口径: a detail claiming ["text"] still yields ['text','image'].
  it('⑤ keeps input = [text,image] even when architecture.input_modalities is [text]', async () => {
    expect(DETAIL_BODY.architecture.input_modalities).toEqual(['text'])
    const { fn } = makeFetch(liveFetch)
    const client = createLongcatClient({ apiKey: FAKE_KEY, fetchFn: fn })
    const entries = await client.listModels()
    expect(entries[0]!.input).toEqual(['text', 'image'])
  })

  // ⑥ chat() injects the binary thinking field and forwards the rest untouched.
  it('⑥ chat() injects enabled/disabled thinking and leaves the rest of the body intact', async () => {
    const { fn, calls } = makeFetch(() => jsonResponse({ ok: true }))
    const client = createLongcatClient({ apiKey: FAKE_KEY, fetchFn: fn })
    const original = {
      model: 'LongCat-2.5',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      temperature: 0.3,
    }

    await client.chat({ ...original }, undefined, true)
    const enabledBody = JSON.parse(String(calls[calls.length - 1]!.init.body)) as Record<string, unknown>
    expect(enabledBody.thinking).toEqual({ type: 'enabled' })

    await client.chat({ ...original }, undefined, false)
    const disabledBody = JSON.parse(String(calls[calls.length - 1]!.init.body)) as Record<string, unknown>
    expect(disabledBody.thinking).toEqual({ type: 'disabled' })

    expect(enabledBody.model).toBe(original.model)
    expect(enabledBody.messages).toEqual(original.messages)
    expect(enabledBody.stream).toBe(true)
    expect(enabledBody.temperature).toBe(0.3)
    expect(calls[calls.length - 1]!.url.endsWith('/chat/completions')).toBe(true)
  })

  // ⑦ The injected fake key never shows up in any client output.
  it('⑦ never echoes the injected fake key in any output', async () => {
    const { fn, calls } = makeFetch(liveFetch)
    const client = createLongcatClient({ apiKey: FAKE_KEY, fetchFn: fn })
    const models = await client.listModels()
    const detail = await client.getModelDetail('LongCat-2.5')
    const chatRes = await client.chat({ model: 'LongCat-2.5', messages: [] }, undefined, true)

    // Only public outputs are stringified: returned values + a sanitized call log
    // (the Authorization header is an input to the mock, not a client output).
    const dumped = [
      JSON.stringify(models),
      JSON.stringify(detail),
      JSON.stringify(chatRes),
      JSON.stringify(calls.map((c) => ({ url: c.url, hasBody: typeof c.init.body }))),
    ].join('\n')
    expect(dumped.includes(FAKE_KEY)).toBe(false)
  })
})
