/**
 * §7-T6-A / catpaw-agent.spec.ts —— 本地妙手 Agent Server 客户端单测。
 *
 * 全部走**注入的 mock fetch**，不发任何真实网络请求。
 * 端口号只是测试夹具：命中端口故意不用 6984，避免把「动态端口」写成硬编码契约。
 *
 * 断言只钉 §3.2 契约的字面量：
 *   - 发现判据（`GET /` 含 'CatPaw Agent Server'）
 *   - `configureFreeModel` 的 PATCH body **只含 model 一个键**
 *   - 目录守卫（缺失工作目录 → 零请求 + 明确错误）
 *   - `x-catpaw-directory` = encodeURIComponent(workingDir)
 *   - SSE 解析（model_chunk 累加 / model_end 取模型名 / agent_end 取 creditCost）
 *   - 工具事件审计（tool_execution_* 收进 toolEvents）
 */
import { describe, expect, it, vi } from 'vitest'
import { configureFreeModel, discoverAgentServer, startChat } from '../src/catpaw-agent.ts'

/** 测试用假工作区（本机不存在）。 */
const WORKDIR = '/fake/workspace/catpaw-demo'
/** 夹具命中端口（避开 6984）。 */
const HIT_PORT = 6987
/** §3.2 / §9 写死的免费模型 ID。 */
const FREE_MODEL_ID = 10002544

type FetchArgs = Parameters<typeof fetch>
type FetchInit = FetchArgs[1]

interface RecordedCall {
  url: string
  method: string
  /** `x-catpaw-directory` 头的原始值（大小写不敏感读取）。 */
  directoryHeader: string | undefined
  body: string | undefined
}

/** 大小写不敏感地读请求头。 */
function headerOf(init: FetchInit, name: string): string | undefined {
  const raw = init?.headers
  if (raw === undefined || raw === null) return undefined
  const wanted = name.toLowerCase()
  if (raw instanceof Headers) return raw.get(wanted) ?? undefined
  if (Array.isArray(raw)) {
    for (const pair of raw) {
      const [key, value] = pair as [string, string]
      if (String(key).toLowerCase() === wanted) return value
    }
    return undefined
  }
  for (const [key, value] of Object.entries(raw as Record<string, string>)) {
    if (key.toLowerCase() === wanted) return value
  }
  return undefined
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * 把事件数组拼成 SSE 文本（`data: <json>` 每行一条）。
 *
 * 真实协议形状（§1 事实 8）：`{"jsonrpc":"2.0","id":"…","event":{"type":"…","data":{…}}}`。
 * 为便于书写，调用方仍传 `{ event: '类型', ...数据字段 }`，此处转换成真实嵌套形状，
 * 保证测试与线上抓到的帧一致（否则解析器按真实协议实现时会解析不到）。
 */
function sseResponse(events: unknown[]): Response {
  const text = events.map((raw) => {
    const { event: type, ...data } = raw as { event?: string } & Record<string, unknown>
    const frame = {
      jsonrpc: '2.0',
      id: 'test-frame',
      event: { type, data },
    }
    return `data: ${JSON.stringify(frame)}\n\n`
  }).join('')
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

/**
 * 构造一个「像妙手 Agent Server」的 fetch 替身。
 *
 * @param hitPort 只有这个端口的 `GET /` 返回 'CatPaw Agent Server'；0 表示全不命中。
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
      directoryHeader: headerOf(init, 'x-catpaw-directory'),
      body: typeof init?.body === 'string' ? init.body : undefined,
    })

    // 发现：只有命中端口的 GET / 返回标记字符串。
    if (parsed.pathname === '/' || parsed.pathname === '') {
      return Number(parsed.port) === options.hitPort
        ? new Response('CatPaw Agent Server', { status: 200 })
        : new Response('not found', { status: 404 })
    }
    // 指定免费模型。
    if (parsed.pathname === '/api/admin/config' && method === 'PATCH') {
      return jsonResponse({ applied: true })
    }
    // 读回确认。
    if (parsed.pathname === '/api/config') {
      return jsonResponse({ model: FREE_MODEL_ID })
    }
    // 一轮对话（JSON-RPC + SSE）。
    if ((parsed.pathname === '/api' || parsed.pathname === '/api/') && method === 'POST') {
      return sseResponse(options.events ?? [])
    }
    return new Response('not found', { status: 404 })
  }
}

/** 一轮标准 SSE 事件（§1 事实 8 / 10 / 11）。 */
function standardEvents(): unknown[] {
  return [
    { event: 'agent_start', conversationId: 'conv-test-1' },
    { event: 'user_message', content: '你好' },
    { event: 'status_update', status: 'running' },
    { event: 'turn_start' },
    { event: 'model_start', model: FREE_MODEL_ID },
    { event: 'model_chunk', content: 'Hello', finished: false },
    { event: 'model_chunk', content: ' world', finished: false },
    { event: 'model_chunk', content: '', finished: true },
    { event: 'model_end', message: { modelDisplayName: 'LongCat-2.5' } },
    { event: 'turn_end' },
    { event: 'artifact_round_summary', artifacts: [] },
    { event: 'agent_end', roundInfo: { creditCost: '0.00000000' }, reason: 'completed' },
  ]
}

describe('catpaw-agent —— discoverAgentServer', () => {
  it('命中 "CatPaw Agent Server" 时返回句柄（baseUrl 指向命中端口）', async () => {
    const server = await discoverAgentServer(makeAgentFetch({ hitPort: HIT_PORT }))
    expect(server).not.toBeNull()
    expect(server!.baseUrl.startsWith('http://127.0.0.1:')).toBe(true)
    expect(server!.baseUrl.endsWith(`:${HIT_PORT}`)).toBe(true)
  })

  it('所有端口都不命中时返回 null（不抛错）', async () => {
    const calls: RecordedCall[] = []
    const server = await discoverAgentServer(makeAgentFetch({ hitPort: 0, calls }))
    expect(server).toBeNull()
    // 确实扫了多个端口，而不是只看一个。
    expect(calls.length).toBeGreaterThan(1)
  })
})

describe('catpaw-agent —— configureFreeModel', () => {
  it('PATCH body 只含 model 一个键，且值为免费模型 ID', async () => {
    const calls: RecordedCall[] = []
    const ok = await configureFreeModel(
      { baseUrl: `http://127.0.0.1:${HIT_PORT}` },
      makeAgentFetch({ hitPort: HIT_PORT, calls }),
    )
    expect(ok).toBe(true)

    const patch = calls.find(call => call.method === 'PATCH')
    expect(patch).toBeDefined()
    expect(patch!.url).toContain('/api/admin/config')

    const payload = JSON.parse(patch!.body ?? '{}') as Record<string, unknown>
    // §1 事实 4：该接口只认 8 个键，多写会污染配置 —— 所以只能写 model。
    expect(Object.keys(payload)).toHaveLength(1)
    expect(payload.model).toBe(FREE_MODEL_ID)
  })
})

describe('catpaw-agent —— startChat 目录守卫', () => {
  it('workingDir 缺失时零请求，返回 ok:false 且 error 含「工作目录」', async () => {
    const fetchMock = vi.fn(async (..._args: FetchArgs): Promise<Response> => {
      throw new Error('缺失工作目录时绝不允许发请求')
    })

    const result = await startChat({
      server: { baseUrl: `http://127.0.0.1:${HIT_PORT}` },
      workingDir: undefined,
      text: 'hi',
      fetchFn: fetchMock,
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('工作目录')
  })
})

describe('catpaw-agent —— startChat 正常路径', () => {
  it('请求头含 x-catpaw-directory，且值为 encodeURIComponent(workingDir)', async () => {
    const calls: RecordedCall[] = []
    await startChat({
      server: { baseUrl: `http://127.0.0.1:${HIT_PORT}` },
      workingDir: WORKDIR,
      text: 'hi',
      fetchFn: makeAgentFetch({ hitPort: HIT_PORT, calls, events: standardEvents() }),
    })

    const post = calls.find(call => call.method === 'POST')
    expect(post).toBeDefined()
    expect(post!.directoryHeader).toBe(encodeURIComponent(WORKDIR))
  })

  it('SSE 解析：model_chunk 累加文本、model_end 取模型名、agent_end 取 creditCost', async () => {
    const result = await startChat({
      server: { baseUrl: `http://127.0.0.1:${HIT_PORT}` },
      workingDir: WORKDIR,
      text: 'hi',
      fetchFn: makeAgentFetch({ hitPort: HIT_PORT, events: standardEvents() }),
    })

    expect(result.ok).toBe(true)
    expect(result.text).toBe('Hello world')
    expect(result.modelName).toBe('LongCat-2.5')
    expect(result.creditCost).toBe('0.00000000')
    expect(result.error).toBeUndefined()
  })

  it('tool_execution_start / tool_execution_result 被收进 toolEvents', async () => {
    const events = [
      { event: 'agent_start' },
      { event: 'tool_execution_start', toolName: 'read_file', args: { path: 'README.md' } },
      { event: 'tool_execution_result', toolName: 'read_file', output: 'hello' },
      { event: 'model_chunk', content: 'done', finished: false },
      { event: 'model_end', message: { modelDisplayName: 'LongCat-2.5' } },
      { event: 'agent_end', roundInfo: { creditCost: '0.00000000' }, reason: 'completed' },
    ]

    const result = await startChat({
      server: { baseUrl: `http://127.0.0.1:${HIT_PORT}` },
      workingDir: WORKDIR,
      text: 'hi',
      fetchFn: makeAgentFetch({ hitPort: HIT_PORT, events }),
    })

    expect(result.toolEvents).toHaveLength(2)
    expect(result.toolEvents.map(event => event.type)).toEqual([
      'tool_execution_start',
      'tool_execution_result',
    ])
    expect(result.toolEvents[0]!.toolName).toBe('read_file')
    expect(result.toolEvents[0]!.args).toEqual({ path: 'README.md' })
    expect(result.toolEvents[1]!.output).toBe('hello')
  })
})
