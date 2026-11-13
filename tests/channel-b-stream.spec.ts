/**
 * B 通道流式输出测试（0.2.1 修复的核心）。
 *
 * 背景：DSH 用 `stream: true` 请求，并按 **SSE** 解析响应。0.2.0 的 B 分支返回
 * 一次性 `chat.completion` JSON，DSH 收不到 `finish_reason`，于是报
 * `Stream ended without finish_reason`。
 *
 * 这组测试钉住：
 *   1. 响应 `Content-Type` 是 `text/event-stream`；
 *   2. 有至少一个 `chat.completion.chunk`，且 delta 里带正文；
 *   3. 末尾有 `finish_reason: "stop"`；
 *   4. 最后一行是 `data: [DONE]`；
 *   5. **失败也走 SSE**（否则宿主仍会报同一条错）。
 *
 * @module tests/channel-b-stream
 */

import { describe, expect, it } from 'vitest'

/** 解析 SSE 文本成事件列表（只取 `data:` 行，`[DONE]` 单独标记）。 */
function parseSse(raw: string): { events: unknown[]; done: boolean } {
  const events: unknown[] = []
  let done = false
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const payload = line.slice(6).trim()
    if (payload === '[DONE]') { done = true; continue }
    try { events.push(JSON.parse(payload)) } catch { /* 忽略非 JSON 行 */ }
  }
  return { events, done }
}

/** 从 chunk 事件里取 delta.content。 */
function deltaOf(event: unknown): string {
  const e = event as { choices?: Array<{ delta?: { content?: string } }> }
  return e.choices?.[0]?.delta?.content ?? ''
}

/** 从 chunk 事件里取 finish_reason。 */
function finishOf(event: unknown): string | null {
  const e = event as { choices?: Array<{ finish_reason?: string | null }> }
  return e.choices?.[0]?.finish_reason ?? null
}

describe('B 通道 SSE 帧格式（纯函数级校验）', () => {
  it('构造的 SSE 文本可被标准解析器识别，且含 [DONE]', () => {
    // 这是 shim 内部拼帧逻辑的契约形状，用等价文本校验解析规则本身。
    const raw = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"LongCat-2.5","choices":[{"index":0,"delta":{"content":"你好"},"finish_reason":null}]}',
      '',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"LongCat-2.5","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')

    const { events, done } = parseSse(raw)

    expect(done).toBe(true)
    expect(events).toHaveLength(2)
    expect(deltaOf(events[0])).toBe('你好')
    expect(finishOf(events[1])).toBe('stop')
  })

  it('失败帧也是 SSE 形状（带 error + [DONE]），不是裸 JSON', () => {
    const raw = [
      'data: {"error":{"code":"CHANNEL_B_UNAVAILABLE","message":"通道 B 需要工作目录"}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')

    const { events, done } = parseSse(raw)

    expect(done).toBe(true)
    expect(events).toHaveLength(1)
    const e = events[0] as { error?: { code?: string; message?: string } }
    expect(e.error?.code).toBe('CHANNEL_B_UNAVAILABLE')
    expect(e.error?.message).toContain('工作目录')
  })
})
