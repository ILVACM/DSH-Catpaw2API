/**
 * §7-T6-B / channel-b-real.spec.ts —— B 通道「打通」测试（mock fetch）。
 *
 * 验证 `createChannelBUpstream()` 的真实编排：
 *   - 成功路径：发现服务 → 指定免费模型 → agent.start → 收敛为 ok:true + 文本
 *   - 未发现服务：ok:false + error 含「未发现本地 Agent Server」
 *   - `probe()` 永不抛错，返回 { available, modelName, reason }
 *
 * 全部走注入的 mock fetch，不发真实网络请求；端口用夹具值，不硬编码 6984。
 */
import { describe, expect, it, vi } from 'vitest'
import { createChannelBUpstream } from '../src/channel-b.ts'

/** 假工作区路径。 */
const WORKDIR = '/fake/workspace/channel-b'
/** 夹具命中端口（避开 6984）。 */
const HIT_PORT = 6987
/** §9 写死的免费模型 ID。 */
const FREE_MODEL_ID = 10002544

type FetchArgs = Parameters<typeof fetch>

interface RecordedCall {
  url: string
  method: string
  body: string | undefined
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * 把事件数组拼成 SSE 文本。
 *
 * 真实信封（temp/P2/code-pre.md §1.3）：
 *   `data: {"jsonrpc":"2.0","id":"<uuid>","event":{"type":"<type>","data":{...}}}`
 * 调用方只写 `{ event: '类型', ...业务字段 }`，信封在这里补。
 */
function sseResponse(events: unknown[]): Response {
  const text = events.map((raw) => {
    const { event: type, ...data } = raw as { event?: string } & Record<string, unknown>
    const frame = { jsonrpc: '2.0', id: 'test-frame', event: { type, data } }
    return `data: ${JSON.stringify(frame)}\n\n`
  }).join('')
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

/**
 * 「妙手在运行」的 fetch 替身。
 *
 * @param hitPort 命中端口；0 表示任何端口都不返回标记字符串（模拟未启动）。
 */
function makeAgentFetch(options: {
  hitPort: number
  events?: unknown[]
  calls?: RecordedCall[]
}): typeof fetch {
  return async (...args: FetchArgs): Promise<Response> => {
    const [input, init] = args
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
    const parsed = new URL(url)
    const method = (init?.method ?? 'GET').toUpperCase()

    options.calls?.push({
      url,
      method,
      body: typeof init?.body === 'string' ? init.body : undefined,
    })

    if (parsed.pathname === '/' || parsed.pathname === '') {
      return Number(parsed.port) === options.hitPort
        ? new Response('CatPaw Agent Server', { status: 200 })
        : new Response('not found', { status: 404 })
    }
    if (parsed.pathname === '/api/admin/config' && method === 'PATCH') {
      return jsonResponse({ applied: true })
    }
    if (parsed.pathname === '/api/config') {
      return jsonResponse({ model: FREE_MODEL_ID })
    }
    if ((parsed.pathname === '/api' || parsed.pathname === '/api/') && method === 'POST') {
      return sseResponse(options.events ?? [])
    }
    return new Response('not found', { status: 404 })
  }
}

/** 一轮成功事件流。 */
function successEvents(): unknown[] {
  return [
    { event: 'agent_start' },
    { event: 'model_chunk', content: '来自本地妙手的回复', finished: false },
    { event: 'model_end', message: { modelDisplayName: 'LongCat-2.5' } },
    { event: 'agent_end', roundInfo: { creditCost: '0.00000000' }, reason: 'completed' },
  ]
}

describe('channel-b —— chat() 成功路径', () => {
  it('发现服务后返回 ok:true + 文本 + 模型名 + 免费 creditCost', async () => {
    const upstream = createChannelBUpstream({
      fetchFn: makeAgentFetch({ hitPort: HIT_PORT, events: successEvents() }),
    })

    const result = await upstream.chat({ workingDir: WORKDIR, text: '你好' })

    expect(result.ok).toBe(true)
    expect(result.text).toBe('来自本地妙手的回复')
    expect(result.modelName).toBe('LongCat-2.5')
    expect(result.creditCost).toBe('0.00000000')
    expect(result.error).toBeUndefined()
  })

  it('透传到 agent.start：PATCH 只写 model，POST 打到 /api', async () => {
    const calls: RecordedCall[] = []
    const upstream = createChannelBUpstream({
      fetchFn: makeAgentFetch({ hitPort: HIT_PORT, events: successEvents(), calls }),
    })

    await upstream.chat({ workingDir: WORKDIR, text: '你好' })

    const patch = calls.find(call => call.method === 'PATCH')
    expect(patch).toBeDefined()
    expect(patch!.url).toContain('/api/admin/config')
    const payload = JSON.parse(patch!.body ?? '{}') as Record<string, unknown>
    expect(Object.keys(payload)).toHaveLength(1)
    expect(payload.model).toBe(FREE_MODEL_ID)

    const post = calls.find(call => call.method === 'POST')
    expect(post).toBeDefined()
    expect(post!.url).toContain('/api')
    const rpc = JSON.parse(post!.body ?? '{}') as Record<string, unknown>
    expect(rpc.method).toBe('agent.start')
    expect(rpc.stream).toBe(true)
  })
})

describe('channel-b —— chat() 失败路径', () => {
  it('未发现本地 Agent Server：ok:false + error 含「未发现本地 Agent Server」', async () => {
    const upstream = createChannelBUpstream({
      // hitPort: 0 → 所有端口都返回 404，模拟妙手未启动。
      fetchFn: makeAgentFetch({ hitPort: 0 }),
    })

    const result = await upstream.chat({ workingDir: WORKDIR, text: '你好' })

    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('未发现本地 Agent Server')
    // 失败结果字段齐全，不返回 undefined。
    expect(result.text).toBe('')
    expect(result.creditCost).toBe('')
    expect(Array.isArray(result.toolEvents)).toBe(true)
  })

  it('fetch 抛错时不向上抛异常，收敛为 ok:false', async () => {
    const fetchMock = vi.fn(async (..._args: FetchArgs): Promise<Response> => {
      throw new Error('boom')
    })

    const upstream = createChannelBUpstream({ fetchFn: fetchMock as unknown as typeof fetch })
    const result = await upstream.chat({ workingDir: WORKDIR, text: '你好' })

    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })
})

describe('channel-b —— probe()', () => {
  it('服务可用时返回 { available:true, modelName, reason }，不抛错', async () => {
    const upstream = createChannelBUpstream({
      fetchFn: makeAgentFetch({ hitPort: HIT_PORT }),
    })

    const probe = await upstream.probe()

    expect(probe.available).toBe(true)
    expect(probe.modelName).toBe('LongCat-2.5')
    expect(typeof probe.reason).toBe('string')
    expect(probe.reason.length).toBeGreaterThan(0)
  })

  it('服务不可用时返回 { available:false, reason }，不抛错', async () => {
    const upstream = createChannelBUpstream({
      fetchFn: makeAgentFetch({ hitPort: 0 }),
    })

    const probe = await upstream.probe()

    expect(probe.available).toBe(false)
    expect(typeof probe.reason).toBe('string')
    expect(probe.reason.length).toBeGreaterThan(0)
    // 即使不可用，模型名也回落到唯一数据源，便于设置页展示。
    expect(probe.modelName).toBe('LongCat-2.5')
  })

  it('fetch 抛错时 probe 也不抛，返回 available:false + 非空 reason', async () => {
    const fetchMock = vi.fn(async (..._args: FetchArgs): Promise<Response> => {
      throw new Error('network down')
    })

    const upstream = createChannelBUpstream({ fetchFn: fetchMock as unknown as typeof fetch })
    // 关键契约：**不抛异常**。原因文案由实现选择（网络错在发现阶段被折叠成
    // 「未发现服务」也是合理的），所以这里只断言非空且不含 undefined。
    const probe = await upstream.probe()

    expect(probe.available).toBe(false)
    expect(typeof probe.reason).toBe('string')
    expect(probe.reason.length).toBeGreaterThan(0)
    expect(probe.reason).not.toContain('undefined')
  })
})
