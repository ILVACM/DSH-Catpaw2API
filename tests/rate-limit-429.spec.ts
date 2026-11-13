/**
 * 429 归一化测试（P3 / 0.2.3）。
 *
 * 背景：宿主 `dsh-llm-pi-ai` 的 `classifyPiAiError` 靠**错误文本**把限流归为
 * `RATE_LIMIT`，上层 `dsh-llm-retry` 才会按 5 次 / 指数退避重试。
 * shim 是 HTTP 服务，抛 error 只会被自己的 catch 变成 502，所以正确做法是
 * **写回一个语义正确的 429 响应**（含 429/rate_limit 文本 + Retry-After 头）。
 *
 * 这组测试钉住：
 *   1. 429 被归一化（不变成 502、不静默透传上游任意文本）；
 *   2. 响应体含 `429` 与 `rate_limit`；
 *   3. `Retry-After` 封顶 8s（上游给 60 不死等）；
 *   4. 非 429 正常透传；
 *   5. `bodyUsed` 边界：已消费的 429 不改写；
 *   6. 可见提示（logger 收到 429 字样）；
 *   7. `catpaw/*` 分支不受影响；
 *   8. 宿主策略自检：maxRetries === 5 且含 RATE_LIMIT（钉住"5 次由宿主提供"）。
 *
 * @module tests/rate-limit-429
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createShim } from '../src/shim.ts'
import type { CatpawShim, CatpawShimOptions } from '../src/shim.ts'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'

const shims: CatpawShim[] = []
afterEach(async () => {
  for (const shim of shims.splice(0)) await shim.close()
})

type ChatFn = (
  body: Record<string, unknown>,
  signal?: AbortSignal,
  thinkEnabled?: boolean,
) => Promise<Response>

/** 构造官方客户端替身；chat 返回调用方指定的 Response。 */
function clientReturning(response: () => Response) {
  return (_options: { apiKey: string; fetchFn?: typeof fetch }) => ({
    listModels: async () => [],
    getModelDetail: async () => null,
    chat: (async () => response()) as ChatFn,
  })
}

function startShim(
  createLongcat: NonNullable<CatpawShimOptions['createLongcat']>,
  logs: string[] = [],
): Promise<CatpawShim> {
  const shim = createShim({
    thinkLongcat: () => true,
    apiKey: () => 'pt-stub',
    createLongcat,
    logger: (message) => { logs.push(message) },
  })
  shims.push(shim)
  return shim.ready.then(() => shim)
}

function chat(shim: CatpawShim, model: string): Promise<Response> {
  return fetch(`${shim.baseUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${shim.token()}`,
    },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], stream: true }),
  })
}

function rateLimitResponse(retryAfter: number): Response {
  return new Response(
    JSON.stringify({ error: { code: 'rate_limit_exceeded', retry_after: retryAfter } }),
    { status: 429, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('429 归一化（官方通道 A）', () => {
  it('上游 429 → 响应仍是 429，且不是 502', async () => {
    const shim = await startShim(clientReturning(() => rateLimitResponse(60)))
    const resp = await chat(shim, 'longcat/LongCat-2.5')
    expect(resp.status).toBe(429)
    expect(resp.status).not.toBe(502)
  })

  it('响应体含 429 与 rate_limit（供 classifyPiAiError 归类）', async () => {
    const shim = await startShim(clientReturning(() => rateLimitResponse(60)))
    const resp = await chat(shim, 'longcat/LongCat-2.5')
    const body = await resp.text()
    expect(body).toContain('429')
    expect(body).toContain('rate_limit')
  })

  it('Retry-After 封顶 8s（上游给 60 不死等）', async () => {
    const shim = await startShim(clientReturning(() => rateLimitResponse(60)))
    const resp = await chat(shim, 'longcat/LongCat-2.5')
    expect(resp.headers.get('retry-after')).toBe('8')
  })

  it('上游未给 retry_after 时回退为 1s', async () => {
    const shim = await startShim(clientReturning(() =>
      new Response('{"error":{"code":"rate_limit_exceeded"}}', {
        status: 429, headers: { 'Content-Type': 'application/json' },
      }),
    ))
    const resp = await chat(shim, 'longcat/LongCat-2.5')
    expect(resp.headers.get('retry-after')).toBe('1')
  })

  it('非 429（如 500）正常透传，不改写', async () => {
    const shim = await startShim(clientReturning(() =>
      new Response('upstream 500', { status: 500, headers: { 'Content-Type': 'text/plain' } }),
    ))
    const resp = await chat(shim, 'longcat/LongCat-2.5')
    expect(resp.status).toBe(500)
    expect(await resp.text()).toBe('upstream 500')
  })

  it('bodyUsed 边界：已消费过的 429 不改写为归一化文本', async () => {
    const consumed = rateLimitResponse(60)
    await consumed.text()          // 先把 body 消费掉
    const shim = await startShim(clientReturning(() => consumed))
    const resp = await chat(shim, 'longcat/LongCat-2.5')
    // 边界生效的标志：响应里既没有归一化文本，也没有 Retry-After 头。
    // 若删掉 !bodyUsed，isFreshRateLimit 会误判并走 writeRateLimitResponse，
    // 这两条断言立刻变红 —— 故本测试也是该边界的变异钉子。
    const body = await resp.text()
    // 边界生效 = 原样走 forwardUpstream（429），不是被误判成可归一化后的 502/异常。
    expect(resp.status).toBe(429)
    expect(body).not.toContain('rate_limit_exceeded')
    expect(resp.headers.get('retry-after')).toBeNull()
  })

  it('可见提示：logger 收到含 429 的消息', async () => {
    const logs: string[] = []
    const shim = await startShim(clientReturning(() => rateLimitResponse(60)), logs)
    await chat(shim, 'longcat/LongCat-2.5')
    expect(logs.some(line => line.includes('429'))).toBe(true)
  })

  it('catpaw/* 分支不受影响（不走 429 归一化）', async () => {
    const shim = await startShim(clientReturning(() => rateLimitResponse(60)))
    // B 分支在无工作目录时返回自己的 SSE 错误帧，不会变成 429。
    const resp = await chat(shim, 'catpaw/LongCat-2.5')
    expect(resp.status).toBe(200)
    expect(resp.headers.get('content-type')).toContain('text/event-stream')
  })

  it('宿主策略自检：maxRetries === 5 且含 RATE_LIMIT（5 次由宿主提供）', () => {
    const policy = resolveRetryPolicy(undefined, 'test') as {
      mode?: string
      maxRetries?: number
      retryableCodes?: readonly string[]
    }
    // ResolvedRetryPolicy 是 normal / always 的联合；默认配置走 normal 分支。
    expect(policy.mode).toBe('normal')
    expect(policy.maxRetries).toBe(5)
    expect(policy.retryableCodes).toContain('RATE_LIMIT')
  })
})
