/**
 * §7-T6-C / workdir-alignment.spec.ts —— **工作目录对齐**契约测试（本阶段最重要）。
 *
 * 背景（temp/P2/probe-report.md / plan.md）：妙手 Agent Server 若收不到
 * `x-catpaw-directory`，就会在**妙手安装目录**里干活，而不是 DSH 会话工作区。
 * 这会让模型读到错误的文件、在错误的目录里执行命令 —— 是功能错误，也是安全问题。
 *
 * 因此本文件把三件事钉死：
 *   1. 请求头**必须有** `x-catpaw-directory`；
 *   2. 其值经 `decodeURIComponent` 后**严格等于**传入的工作区路径；
 *   3. 工作目录缺失（undefined / 空串 / 纯空白）时**零请求**，且错误文案明说
 *      「需要工作目录」，不是泛泛的「调用失败」。
 *
 * 全部走 mock fetch，不发真实网络请求。
 */
import { describe, expect, it, vi } from 'vitest'
import { startChat } from '../src/catpaw-agent.ts'
import { createChannelBUpstream } from '../src/channel-b.ts'

/** 带空格 / 中文 / 反斜杠的假路径：故意选需要编码的字符，才能测出「忘了 encode」。 */
const WORKDIR_WITH_SPACES = 'C:\\fake\\workspace\\妙手 demo (p2)'
/** 另一条对照路径。 */
const WORKDIR_PLAIN = '/fake/workspace/plain'
/** 夹具命中端口（避开 6984）。 */
const HIT_PORT = 6987

type FetchArgs = Parameters<typeof fetch>
type FetchInit = FetchArgs[1]

interface RecordedCall {
  url: string
  method: string
  directoryHeader: string | undefined
  body: string | undefined
}

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

function sseResponse(events: unknown[]): Response {
  const text = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

/** 最小可用事件流：能让 startChat 正常收敛为 ok:true。 */
function minimalEvents(): unknown[] {
  return [
    { event: 'agent_start' },
    { event: 'model_chunk', content: 'ok', finished: false },
    { event: 'model_end', message: { modelDisplayName: 'LongCat-2.5' } },
    { event: 'agent_end', roundInfo: { creditCost: '0.00000000' }, reason: 'completed' },
  ]
}

/** 一个会记录每次调用（含目录头）的 Agent Server fetch 替身。 */
function recordingFetch(calls: RecordedCall[], events: unknown[] = minimalEvents()): typeof fetch {
  return async (...args: FetchArgs): Promise<Response> => {
    const [input, init] = args
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
    const parsed = new URL(url)
    const method = (init?.method ?? 'GET').toUpperCase()

    calls.push({
      url,
      method,
      directoryHeader: headerOf(init, 'x-catpaw-directory'),
      body: typeof init?.body === 'string' ? init.body : undefined,
    })

    if (parsed.pathname === '/' || parsed.pathname === '') {
      return Number(parsed.port) === HIT_PORT
        ? new Response('CatPaw Agent Server', { status: 200 })
        : new Response('not found', { status: 404 })
    }
    if (parsed.pathname === '/api/admin/config' && method === 'PATCH') {
      return jsonResponse({ applied: true })
    }
    if (parsed.pathname === '/api/config') {
      return jsonResponse({ model: 10002544 })
    }
    if ((parsed.pathname === '/api' || parsed.pathname === '/api/') && method === 'POST') {
      return sseResponse(events)
    }
    return new Response('not found', { status: 404 })
  }
}

describe('工作目录对齐 —— 请求头必须携带目录', () => {
  it('startChat 发出的对话请求头必有 x-catpaw-directory', async () => {
    const calls: RecordedCall[] = []
    await startChat({
      server: { baseUrl: `http://127.0.0.1:${HIT_PORT}` },
      workingDir: WORKDIR_PLAIN,
      text: '列出当前目录文件',
      fetchFn: recordingFetch(calls),
    })

    const post = calls.find(call => call.method === 'POST')
    expect(post).toBeDefined()
    // 头存在且非空 —— 缺了它妙手就会在安装目录里干活。
    expect(post!.directoryHeader).toBeTruthy()
    expect(typeof post!.directoryHeader).toBe('string')
  })

  it('目录头经 decodeURIComponent 后严格等于传入的工作区路径（含空格/中文）', async () => {
    const calls: RecordedCall[] = []
    await startChat({
      server: { baseUrl: `http://127.0.0.1:${HIT_PORT}` },
      workingDir: WORKDIR_WITH_SPACES,
      text: 'hi',
      fetchFn: recordingFetch(calls),
    })

    const post = calls.find(call => call.method === 'POST')
    expect(post).toBeDefined()
    const raw = post!.directoryHeader
    expect(raw).toBeDefined()

    // 传输值必须是编码后的形态（含空格/中文的路径不能裸传）。
    expect(raw).toBe(encodeURIComponent(WORKDIR_WITH_SPACES))
    // 解码回来必须**严格相等**，不是"包含"、不是"近似"。
    expect(decodeURIComponent(raw!)).toBe(WORKDIR_WITH_SPACES)
  })

  it('对照：不同工作区产生不同目录头（不是写死的常量）', async () => {
    const firstCalls: RecordedCall[] = []
    const secondCalls: RecordedCall[] = []

    await startChat({
      server: { baseUrl: `http://127.0.0.1:${HIT_PORT}` },
      workingDir: WORKDIR_PLAIN,
      text: 'hi',
      fetchFn: recordingFetch(firstCalls),
    })
    await startChat({
      server: { baseUrl: `http://127.0.0.1:${HIT_PORT}` },
      workingDir: WORKDIR_WITH_SPACES,
      text: 'hi',
      fetchFn: recordingFetch(secondCalls),
    })

    const first = firstCalls.find(call => call.method === 'POST')!.directoryHeader
    const second = secondCalls.find(call => call.method === 'POST')!.directoryHeader
    expect(first).not.toBe(second)
    expect(decodeURIComponent(first!)).toBe(WORKDIR_PLAIN)
    expect(decodeURIComponent(second!)).toBe(WORKDIR_WITH_SPACES)
  })
})

describe('工作目录对齐 —— 缺失目录时必须零请求', () => {
  it('workingDir === undefined：零请求 + ok:false + error 含「需要工作目录」', async () => {
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
    // 文案必须明确指向工作目录，而不是泛泛的「失败」。
    expect(result.error).toContain('需要工作目录')
  })

  it('workingDir === ""（空串）：零请求 + ok:false + error 含「需要工作目录」', async () => {
    const fetchMock = vi.fn(async (..._args: FetchArgs): Promise<Response> => {
      throw new Error('空工作目录时绝不允许发请求')
    })

    const result = await startChat({
      server: { baseUrl: `http://127.0.0.1:${HIT_PORT}` },
      workingDir: '',
      text: 'hi',
      fetchFn: fetchMock,
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.error).toContain('需要工作目录')
  })

  it('workingDir 为纯空白：同样零请求 + 拒绝', async () => {
    const fetchMock = vi.fn(async (..._args: FetchArgs): Promise<Response> => {
      throw new Error('空白工作目录时绝不允许发请求')
    })

    const result = await startChat({
      server: { baseUrl: `http://127.0.0.1:${HIT_PORT}` },
      workingDir: '   ',
      text: 'hi',
      fetchFn: fetchMock,
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.error).toContain('需要工作目录')
  })
})

describe('工作目录对齐 —— B 通道层同样拒绝（不"退回不传目录"）', () => {
  it('createChannelBUpstream().chat() 缺 workingDir 时零请求 + ok:false + error 含「工作目录」', async () => {
    const fetchMock = vi.fn(async (..._args: FetchArgs): Promise<Response> => {
      throw new Error('缺失工作目录时绝不允许发请求')
    })

    const result = await createChannelBUpstream({ fetchFn: fetchMock as unknown as typeof fetch })
      .chat({ workingDir: undefined, text: 'hi' })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('工作目录')
  })

  it('B 通道成功路径把目录头透传到 agent.start', async () => {
    const calls: RecordedCall[] = []
    const upstream = createChannelBUpstream({
      fetchFn: recordingFetch(calls) as unknown as typeof fetch,
    })

    const result = await upstream.chat({ workingDir: WORKDIR_WITH_SPACES, text: 'hi' })
    expect(result.ok).toBe(true)

    const post = calls.find(call => call.method === 'POST' && call.url.includes('/api'))
    expect(post).toBeDefined()
    expect(post!.directoryHeader).toBeDefined()
    expect(decodeURIComponent(post!.directoryHeader!)).toBe(WORKDIR_WITH_SPACES)
  })
})
