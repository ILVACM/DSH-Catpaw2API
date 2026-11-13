/**
 * §7-T4 / shim.spec.ts —— 回环 shim 安全模型 + 前缀分流 + F9 思考注入。
 *
 * 用**裸 socket** 测 Host 头（fetch 会覆盖 Host 头，测不了 DNS rebinding 场景）；
 * 其余用 fetch。官方侧 chat 用注入的工厂替身，不真联网：记录收到的
 * body/signal/thinkLongcat，并验证 thinking 字段被注入。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createConnection } from 'node:net'
import { createShim } from '../src/shim.ts'
import type { CatpawShim, CatpawShimOptions } from '../src/shim.ts'

const shims: CatpawShim[] = []

interface ChatCall {
  body: Record<string, unknown>
  signal: AbortSignal | undefined
  thinkLongcat: boolean
}

/** 官方客户端替身：记录 chat 入参，并注入 thinking 后返回一个假 Response。 */
function stubFactory(calls: ChatCall[]) {
  return (_options: { apiKey: string; fetchFn?: typeof fetch }) => ({
    listModels: async () => [],
    getModelDetail: async () => null,
    chat: async (body: Record<string, unknown>, signal?: AbortSignal, thinkEnabled: boolean = true) => {
      const payload = { ...body, thinking: { type: thinkEnabled ? 'enabled' : 'disabled' } }
      calls.push({ body: payload, signal, thinkLongcat: thinkEnabled })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })
}

function startShim(overrides: Partial<CatpawShimOptions> = {}): Promise<CatpawShim> {
  const shim = createShim({
    thinkLongcat: () => true,
    apiKey: () => 'pt-stub',
    logger: () => {},
    ...overrides,
  })
  shims.push(shim)
  return shim.ready.then(() => shim)
}

function chat(shim: CatpawShim, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${shim.baseUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${shim.token()}`,
      ...headers,
    },
    body: JSON.stringify({ model: 'longcat/LongCat-2.5', messages: [{ role: 'user', content: 'hi' }], ...body }),
  })
}

/**
 * 裸 socket 写一条 HTTP 请求并读完整响应。fetch 会强制把 Host 写成 URL 的
 * authority，测不了「Host 头伪造」这一路；只有裸写才能指定任意 Host。
 */
function rawHttp(
  port: number,
  raw: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    let buf = ''
    socket.on('connect', () => socket.write(raw))
    socket.on('data', (chunk: Buffer) => { buf += chunk.toString('utf8') })
    socket.on('end', () => {
      const headEnd = buf.indexOf('\r\n\r\n')
      const head = headEnd >= 0 ? buf.slice(0, headEnd) : buf
      const body = headEnd >= 0 ? buf.slice(headEnd + 4) : ''
      const status = Number((/^HTTP\/1\.1 (\d+)/.exec(head)?.[1]) ?? 0)
      resolve({ status, body })
    })
    socket.on('error', reject)
  })
}

afterEach(async () => {
  while (shims.length > 0) {
    const shim = shims.pop()!
    await shim.close()
  }
})

describe('shim —— 入站 Host 头校验（DNS rebinding 防线）', () => {
  it('伪造 Host 头在路由判定之前被拒为 403 host_not_allowed', async () => {
    const shim = await startShim()
    const port = Number(new URL(shim.baseUrl()).port)
    const raw = [
      'POST /healthz HTTP/1.1',
      'Host: evil.example.com',
      'Authorization: Bearer ' + shim.token(),
      'Content-Type: application/json',
      'Content-Length: 0',
      'Connection: close',
      '',
      '',
    ].join('\r\n')
    const { status, body } = await rawHttp(port, raw)
    expect(status).toBe(403)
    expect((JSON.parse(body) as { error: { code: string } }).error.code).toBe('host_not_allowed')
  })

  it('回环 Host 且合法 secret 的探活返回 200', async () => {
    const shim = await startShim()
    const port = Number(new URL(shim.baseUrl()).port)
    const raw = [
      'GET /healthz HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Authorization: Bearer ' + shim.token(),
      'Connection: close',
      '',
      '',
    ].join('\r\n')
    const { status } = await rawHttp(port, raw)
    expect(status).toBe(200)
  })
})

describe('shim —— A 前缀分流 + F9 思考注入', () => {
  it('longcat/ 前缀进入官方 chat，收到 thinkLongcat 并注入 thinking', async () => {
    const calls: ChatCall[] = []
    const shim = await startShim({ createLongcat: stubFactory(calls) })
    const resp = await chat(shim, {})
    expect(resp.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.thinkLongcat).toBe(true)
    expect(calls[0]!.body).toMatchObject({
      thinking: { type: 'enabled' },
    })
    // signal 必须是 AbortSignal（res.on('close') 取消链）。
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal)
  })

  /**
   * `longcat/` 前缀只是 DSH 选择器里的路由标记，官方 API 只认裸模型 id。
   * 带着前缀发出去会被官方拒：400 invalid_parameter
   * `Unsupported model (model=longcat/LongCat-2.0)`。
   *
   * 0.1.x 的 `stripPrefix` 只定义没被调用，这条断言就是为此钉住的。
   */
  it('转发给官方前剥掉 longcat/ 前缀（官方只认裸模型 id）', async () => {
    const calls: ChatCall[] = []
    const shim = await startShim({ createLongcat: stubFactory(calls) })
    await chat(shim, { model: 'longcat/LongCat-2.0' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.body.model).toBe('LongCat-2.0')
    // 绝不能把带前缀的 id 发给上游
    expect(String(calls[0]!.body.model).startsWith('longcat/')).toBe(false)
  })

  it('thinkLongcat=false 时注入 thinking:{"type":"disabled"}', async () => {
    const calls: ChatCall[] = []
    const shim = await startShim({ thinkLongcat: () => false, createLongcat: stubFactory(calls) })
    await chat(shim, {})
    expect(calls).toHaveLength(1)
    expect(calls[0]!.thinkLongcat).toBe(false)
    expect(calls[0]!.body.thinking).toEqual({ type: 'disabled' })
  })

  it('其余 body（含 stream）原样透传', async () => {
    const calls: ChatCall[] = []
    const shim = await startShim({ createLongcat: stubFactory(calls) })
    await chat(shim, { stream: true, temperature: 0.5 })
    expect(calls[0]!.body.stream).toBe(true)
    expect(calls[0]!.body.temperature).toBe(0.5)
  })

  it('secret 错误 → 401，不进入任何上游', async () => {
    const calls: ChatCall[] = []
    const shim = await startShim({ createLongcat: stubFactory(calls) })
    const resp = await fetch(`${shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' },
      body: JSON.stringify({ model: 'longcat/LongCat-2.5' }),
    })
    expect(resp.status).toBe(401)
    expect(calls).toHaveLength(0)
  })
})

describe('shim —— B 分支（阶段二真实通道）', () => {
  it('catpaw/ 前缀在无工作目录时返回 SSE + CHANNEL_B_UNAVAILABLE，且不调官方 chat', async () => {
    const calls: ChatCall[] = []
    const shim = await startShim({ createLongcat: stubFactory(calls) })
    const resp = await chat(shim, { model: 'catpaw/LongCat-2.5' })
    expect(resp.status).toBe(200)
    // 0.2.1：B 分支统一按 SSE 输出（DSH 按流式解析，裸 JSON 会触发
    // `Stream ended without finish_reason`）。失败也用 SSE 帧表达。
    expect(resp.headers.get('content-type')).toContain('text/event-stream')
    const raw = await resp.text()
    expect(raw).toContain('data: [DONE]')
    const errorLine = raw.split('\n').find(line => line.includes('CHANNEL_B_UNAVAILABLE'))
    expect(errorLine).toBeDefined()
    const payload = JSON.parse(errorLine!.slice(6)) as { error: { code: string; message: string } }
    expect(payload.error.code).toBe('CHANNEL_B_UNAVAILABLE')
    expect(payload.error.message).toContain('工作目录')
    expect(calls).toHaveLength(0)
  })
})
