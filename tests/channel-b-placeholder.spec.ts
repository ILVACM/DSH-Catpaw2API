/**
 * §7-T6-D / channel-b-placeholder.spec.ts —— B 通道**真实行为**断言。
 *
 * 阶段一这里断言「所有方法都是占位、一律不实现」。阶段二起 B 通道是
 * 真实实现（`chat()` 走本地 Agent Server，`probe()` 做状态检测），所以本文件
 * **整体重写**：
 *
 *   - `chat()` 在 `workingDir` 缺失时返回 `{ ok:false }` + 明确错误文案，**不抛异常**；
 *   - `probe()` 探测失败时返回 `{ available:false, reason }`，**不抛异常**；
 *   - 已移除的方法（`listModels` / `readCredits` / `readContextTiers` /
 *     `applyContextTier` / `refresh`）不再断言 —— 它们已从契约里删掉。
 *
 * 全部走注入的 mock fetch，零真实网络。
 */
import { describe, expect, it, vi } from 'vitest'
import { createChannelBUpstream } from '../src/channel-b.ts'

type FetchArgs = Parameters<typeof fetch>

/** 假工作区路径（本机不存在）。 */
const WORKDIR = '/fake/workspace/catpaw-placeholder'

/** 记录调用但绝不联网的 fetch 替身。 */
function spyFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (..._args: FetchArgs): Promise<Response> => {
    throw new Error('network must not be reached in this test')
  })
}

describe('channel-b —— 契约形状（阶段二真实通道）', () => {
  it('只暴露 chat() 与 probe() 两个方法（旧占位方法已移除）', () => {
    const upstream = createChannelBUpstream({ fetchFn: spyFetch() as unknown as typeof fetch })
    expect(typeof upstream.chat).toBe('function')
    expect(typeof upstream.probe).toBe('function')
    // 阶段一的方法必须真的不在了，否则说明移除没做完。
    expect('listModels' in upstream).toBe(false)
    expect('readCredits' in upstream).toBe(false)
    expect('readContextTiers' in upstream).toBe(false)
    expect('applyContextTier' in upstream).toBe(false)
    expect('refresh' in upstream).toBe(false)
  })
})

describe('channel-b —— chat() 缺工作目录时拒绝且不抛', () => {
  it('workingDir === undefined：返回 { ok:false } + 错误文案，不抛异常，零请求', async () => {
    const fetchMock = spyFetch()
    const upstream = createChannelBUpstream({ fetchFn: fetchMock as unknown as typeof fetch })

    // 关键：chat() 契约是「不抛错」，所以直接 await 拿结果，而不是用 rejects。
    const result = await upstream.chat({ workingDir: undefined, text: 'hi' })

    expect(result.ok).toBe(false)
    expect(typeof result.error).toBe('string')
    expect(result.error).toContain('工作目录')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('workingDir === ""（空串）：同样 { ok:false } + 错误文案，不抛异常', async () => {
    const fetchMock = spyFetch()
    const upstream = createChannelBUpstream({ fetchFn: fetchMock as unknown as typeof fetch })

    const result = await upstream.chat({ workingDir: '', text: 'hi' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('工作目录')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('失败结果字段齐全（text/modelName/creditCost 为空串、toolEvents 为空数组）', async () => {
    const upstream = createChannelBUpstream({ fetchFn: spyFetch() as unknown as typeof fetch })

    const result = await upstream.chat({ workingDir: undefined, text: 'hi' })

    expect(result.ok).toBe(false)
    expect(result.text).toBe('')
    expect(result.modelName).toBe('')
    expect(result.creditCost).toBe('')
    expect(result.toolEvents).toEqual([])
  })
})

describe('channel-b —— probe() 失败时不抛', () => {
  it('探测失败（网络异常）返回 { available:false, reason }，不抛异常', async () => {
    const fetchMock = spyFetch()
    const upstream = createChannelBUpstream({ fetchFn: fetchMock as unknown as typeof fetch })

    const probe = await upstream.probe()

    expect(probe.available).toBe(false)
    expect(typeof probe.reason).toBe('string')
    expect(probe.reason.length).toBeGreaterThan(0)
    expect(typeof probe.modelName).toBe('string')
    expect(probe.modelName.length).toBeGreaterThan(0)
  })

  it('未发现服务时返回 available:false 且 reason 说明未发现 Agent Server', async () => {
    // 所有端口都 404 → 模拟妙手未启动。
    const fetchMock = vi.fn(async (..._args: FetchArgs): Promise<Response> =>
      new Response('not found', { status: 404 }))
    const upstream = createChannelBUpstream({ fetchFn: fetchMock as unknown as typeof fetch })

    const probe = await upstream.probe()

    expect(probe.available).toBe(false)
    expect(probe.reason).toContain('未发现本地 Agent Server')
  })
})

describe('channel-b —— 成功路径不依赖真实网络', () => {
  it('mock fetch 全链路成功时返回 ok:true（证明编排可用）', async () => {
    const fetchMock = vi.fn(async (...args: FetchArgs): Promise<Response> => {
      const [input, init] = args
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
      const parsed = new URL(url)
      const method = (init?.method ?? 'GET').toUpperCase()

      if (parsed.pathname === '/' || parsed.pathname === '') {
        return new Response('CatPaw Agent Server', { status: 200 })
      }
      if (parsed.pathname === '/api/admin/config' && method === 'PATCH') {
        return new Response(JSON.stringify({ applied: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (parsed.pathname === '/api/config') {
        return new Response(JSON.stringify({ model: 10002544 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const events = [
        { event: 'model_chunk', data: { content: 'hi', finished: false } },
        { event: 'model_end', data: { message: { modelDisplayName: 'LongCat-2.5' } } },
        { event: 'agent_end', data: { roundInfo: { creditCost: '0.00000000' }, reason: 'completed' } },
      ]
      // 真实信封：`{"jsonrpc":"2.0","id":"…","event":{"type":"…","data":{…}}}`。
      const text = events
        .map(({ event: type, data }) => `data: ${JSON.stringify({ jsonrpc: '2.0', id: 'f', event: { type, data } })}\n\n`)
        .join('')
      return new Response(text, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    })

    const upstream = createChannelBUpstream({ fetchFn: fetchMock as unknown as typeof fetch })
    const result = await upstream.chat({ workingDir: WORKDIR, text: '你好' })

    expect(result.ok).toBe(true)
    expect(result.text).toBe('hi')
    expect(result.modelName).toBe('LongCat-2.5')
  })
})
