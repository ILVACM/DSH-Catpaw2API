/**
 * 回环 shim：进程内 HTTP 服务（127.0.0.1 随机端口）。
 *
 * 安全模型以 qoder `src/shim.ts` 为**结构参照**独立重写（未复制其源码）：
 * - `server.listen(0, '127.0.0.1')`：端口由内核分配，仅绑定回环；
 * - 进程内 `randomBytes(32)` 生成 secret（base64url），只存在内存里，
 *   pi-ai 仅拿到这个 secret 当 apiKey，真实 LongCat 凭据绝不交给 pi-ai；
 * - 入站**三重校验**：Host / Origin / Content-Type，且 `Authorization`
 *   用 `timingSafeEqual` 常量时间比对（先比长度）；四个校验都在路由判定之前；
 * - 请求体有上限（默认 64 MiB），超限回 413 并 drain，不拆 socket；
 * - 客户端断连的取消监听 `res.on('close')`（不是 `req.on('close')`）。
 *
 * 职责（阶段二）：按 `channelOf(modelId)` 把 OpenAI 聊天请求分流：
 * - `longcat` → 调 `createLongcatClient().chat(body, signal, thinkLongcat)` 转发，
 *   并把 `Config.thinkLongcat` 传入（F9 官方侧「深度思考」开关真正生效）；
 * - `catpaw` → 调 `createChannelBUpstream().chat()` 走本地 Agent Server
 *   （施工队模式）。工作目录由请求体 `workingDir` 带给妙手。
 *   失败时**仍返回 HTTP 200** + 结构化错误体
 *   `{ error: { code: 'CHANNEL_B_UNAVAILABLE', message } }`：
 *   用 200 而非 5xx 是刻意的，避免宿主把它当成网络故障原地重试。
 *
 * 本文件不读本机凭据文件、不拼私有请求头、不改写上游路径、不解 SSE
 * （SSE 解析在 `catpaw-agent.ts`）。
 *
 * 用户可见文案一律「妙手」；技术标识（`catpaw/` 前缀等）原样保留。
 *
 * @module dsh-connect-catpaw/shim
 */

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { channelOf, stripPrefix, CATPAW_MODEL_NAME } from './routing.ts'
import { createLongcatClient } from './longcat.ts'
import { createChannelBUpstream } from './channel-b.ts'
import type { ChannelBChatRequest } from './channel-b.ts'

/** createLongcatClient() 的返回形态（§3.5 三方法；chat 返回 Response）。 */
type LongcatClient = ReturnType<typeof createLongcatClient>

/** B 通道 upstream 的返回形态（chat + probe）。 */
type ChannelBUpstream = ReturnType<typeof createChannelBUpstream>

/** 请求体字节上限（默认 64 MiB，对齐 qoder 同款安全模型）。测试可注入小值。 */
const REQUEST_BODY_LIMIT = 64 * 1024 * 1024

/** 入站 Content-Type 必须是 application/json（挡 simple-request CSRF）。 */
const CONTENT_TYPE_JSON = 'application/json'

/** 官方通道限流：HTTP 429。只认这个状态码，其它一律不特殊处理。 */
const RATE_LIMIT_STATUS = 429

/**
 * 429 归一化后的错误文本：必须同时含 `429` 与 `rate_limit`。
 *
 * 为什么：宿主 `dsh-llm-pi-ai` 的 `classifyPiAiError(text)` 靠文本匹配
 * `/\b429\b|rate.?limit/i` 归类为 `RATE_LIMIT`，上层 `dsh-llm-retry` 才会按
 * 5 次 / 指数退避重新发起请求。若上游 429 响应体没有这两个字样，宿主会把限流
 * 当成普通错误，用户就得手动重试。
 */
const RATE_LIMIT_BODY = JSON.stringify({
  error: {
    code: 'rate_limit_exceeded',
    message: 'longcat upstream answered 429 (rate_limit_exceeded)',
    type: 'rate_limit_error',
  },
})

/** 进程内 secret 类型暴露的最小契约（adapter 用它当 apiKey）。 */
export interface CatpawShim {
  /** 在端口就绪后 resolve；装配顺序必须 `await shim.ready` 再造 adapter。 */
  ready: Promise<void>
  /** 形如 `http://127.0.0.1:<port>`，每次重新读 `server.address()`。 */
  baseUrl(): string
  /** 进程内随机 secret；pi-ai 的 `resolveApiKey` 返回它。 */
  token(): string
  /** 关闭回环服务（析构时调用）。 */
  close(): Promise<void>
}

export interface CatpawShimOptions {
  /**
   * F9 官方侧「深度思考」二值开关（`Config.thinkLongcat`）。
   * 阶段一以取值器传入，保证运行期改设置后下一次 chat 立刻用新值。
   */
  thinkLongcat: () => boolean
  /** 官方通道使用的 API Key（设置卡/环境变量解析，由 index.ts 注入）。 */
  apiKey: () => string | undefined
  /** 可注入的官方客户端工厂（测试替身）；缺省用 `createLongcatClient`。 */
  createLongcat?: (options: { apiKey: string; fetchFn?: typeof fetch }) => LongcatClient
  /** 可注入的 B 通道 upstream 工厂（测试替身）；缺省用 `createChannelBUpstream`。 */
  createChannelB?: (options: { fetchFn?: typeof fetch }) => ChannelBUpstream
  /** 可注入 fetch（测试替身）；透传给官方客户端。 */
  fetchFn?: typeof fetch
  /** 可注入请求体上限（测试用小值触发 413）。 */
  requestBodyLimit?: number
  /** 诊断日志（缺省静默）。 */
  logger?: (message: string) => void
}

/** Host 必须严格指向回环（防 DNS rebinding）。 */
function checkHost(req: IncomingMessage): boolean {
  const host = req.headers.host ?? ''
  return /^127\.0\.0\.1:\d+$/.test(host)
}

/**
 * Origin 若存在必须指向回环。非浏览器客户端（pi-ai / 插件自己）不发 Origin，
 * 直接放行；DNS-rebinding 页面可伪造 Host，但 Origin 会暴露真实域名。
 */
function originIsLoopback(origin: string | undefined): boolean {
  if (origin === undefined || origin === '') return true
  try {
    const url = new URL(origin)
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  } catch {
    return false
  }
}

/** Authorization: Bearer <secret> —— 常量时间比对（长度不同直接拒绝）。 */
function checkAuthorization(req: IncomingMessage, expected: Buffer): boolean {
  const header = req.headers.authorization
  if (typeof header !== 'string') return false
  const match = /^Bearer (.+)$/.exec(header)
  if (!match) return false
  const actual = Buffer.from(match[1] ?? '')
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

/** GET 免检 Content-Type；其它方法必须 application/json。 */
function checkContentType(req: IncomingMessage): boolean {
  if (req.method === 'GET') return true
  const ct = req.headers['content-type'] ?? ''
  return String(ct).startsWith(CONTENT_TYPE_JSON)
}

/** 读取请求体，超过 limit 抛 'request body too large'（并 drain 而不是 destroy）。 */
function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let over = false
    req.on('data', (chunk: Buffer) => {
      if (over) return
      size += chunk.length
      if (size > limit) {
        over = true
        reject(new Error('request body too large'))
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

/** OpenAI 形状 JSON 错误体；`res` 已结束/销毁时静默跳过。 */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return
  const text = JSON.stringify(body)
  // Set Content-Length explicitly: without it Node uses chunked encoding, and
  // raw HTTP clients (and some probes) would see a hex length line before the
  // JSON body instead of a parseable object.
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  })
  res.end(text)
}

/**
 * 从 OpenAI 请求体里取最后一条 user 文本（content 可能是字符串或数组）。
 *
 * 兼容两种 content 形状：
 * - `"content": "纯文本"`；
 * - `"content": [{ type: 'text', text: '...' }, ...]`（多段，只拼 text 段）。
 * 取**最后一条** user 消息：多轮历史里最新那条才是本轮输入。
 */
function extractUserText(body: Record<string, unknown>): string {
  const messages = body.messages
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as Record<string, unknown> | null | undefined
    if (message === null || message === undefined) continue
    if (message.role !== 'user') continue
    const content = message.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      const parts: string[] = []
      for (const part of content) {
        if (typeof part !== 'object' || part === null) continue
        const piece = part as Record<string, unknown>
        if (typeof piece.text === 'string') parts.push(piece.text)
      }
      return parts.join('')
    }
    return ''
  }
  return ''
}

/**
 * 宿主注入的工作目录行（`@deepseek-ai/dsh-working-directory` 的 system prompt 上下文）。
 *
 * 宿主的实现是：
 *   `Current working directory: ${JSON.stringify(directory)}.`
 * 且该上下文标记 `required: true`，所以**每个请求都会带**。
 * 这是 0.2.1 的关键修复：0.2.0 只读 `body.workingDir`，而标准 OpenAI 请求里没有这个字段。
 */
const WORKDIR_PATTERN = /Current working directory:\s*("(?:[^"\\]|\\.)*")/

/**
 * 从请求体里取会话工作目录。
 *
 * 优先级：
 *   1. `body.workingDir`（显式传参，兼容旧行为与测试注入）；
 *   2. `messages` 里宿主注入的 `Current working directory: "…".`
 *
 * 都拿不到时返回 `undefined` —— **绝不回落到 `process.cwd()`**：
 * 那会让妙手在错误的目录里执行工具，用户看到不相干的文件却以为"通道坏了"。
 *
 * @param body - 已解析的 OpenAI 请求体。
 * @returns 绝对路径，或 `undefined`（表示"不知道"）。
 */
export function extractWorkingDir(body: Record<string, unknown>): string | undefined {
  const explicit = body.workingDir
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit

  const messages = body.messages
  if (!Array.isArray(messages)) return undefined

  // 从后往前找：宿主把工作目录上下文 prepend 到最前，但多轮历史里后面也可能重复出现，
  // 取最后一次出现更贴近"当前"目录（用户 /cd 之后会追加新的一行）。
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as Record<string, unknown> | null | undefined
    if (message === null || message === undefined) continue
    const found = matchWorkingDirIn(message.content)
    if (found !== undefined) return found
  }
  return undefined
}

/** 在单条消息的 content（字符串或多段数组）里找工作目录行。 */
function matchWorkingDirIn(content: unknown): string | undefined {
  if (typeof content === 'string') return parseWorkingDirText(content)
  if (!Array.isArray(content)) return undefined
  for (let i = content.length - 1; i >= 0; i -= 1) {
    const part = content[i]
    if (typeof part !== 'object' || part === null) continue
    const text = (part as Record<string, unknown>).text
    if (typeof text !== 'string') continue
    const found = parseWorkingDirText(text)
    if (found !== undefined) return found
  }
  return undefined
}

/** 用正则取出 JSON 字符串字面量并还原成路径。 */
function parseWorkingDirText(text: string): string | undefined {
  const match = WORKDIR_PATTERN.exec(text)
  if (match === null) return undefined
  try {
    const value = JSON.parse(match[1] as string) as unknown
    if (typeof value === 'string' && value.trim() !== '') return value
  } catch {
    // 非法 JSON 字面量：当作没找到。
  }
  return undefined
}

/**
 * 判断一个上游 Response 是否为「尚未吐字」的 429。
 *
 * `!bodyUsed` 是安全边界：只处理一个字都还没开始流的 429；
 * 已经开始流式后绝不改写，否则会破坏已输出的流（用户会看到两段重复的话）。
 */
function isFreshRateLimit(response: Response): boolean {
  return response.status === RATE_LIMIT_STATUS && !response.bodyUsed
}

/** 从 429 响应体里读 retry_after（秒）；读不到返回 undefined。 */
function parseRetryAfter(raw: string): number | undefined {
  try {
    const value = (JSON.parse(raw) as { error?: { retry_after?: unknown } }).error?.retry_after
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * 写回一个「宿主可正确归类」的 429 响应。
 *
 * 不抛 error：shim 是 HTTP 服务，throw 只会被本文件的 catch 变成 502，到不了宿主。
 * 关键是让 **HTTP 429 响应本身**带含 `429`/`rate_limit` 的错误文本 + `Retry-After` 头，
 * 由宿主 `dsh-llm-retry` 按 5 次 / 指数退避接手重试。
 *
 * `Retry-After` 封顶 8s：上游可能给 60，直接透传会让宿主死等；取 1–8s。
 */
function writeRateLimitResponse(res: ServerResponse, raw: string): void {
  if (res.writableEnded || res.destroyed) return
  const hint = parseRetryAfter(raw)
  const retryAfter = hint === undefined ? 1 : Math.min(Math.max(hint, 1), 8)
  res.writeHead(RATE_LIMIT_STATUS, {
    'Content-Type': 'application/json; charset=utf-8',
    // Content-Length 必须显式给出：某些 raw HTTP 客户端不接受 chunked 的短错误体。
    'Content-Length': String(Buffer.byteLength(RATE_LIMIT_BODY, 'utf8')),
    'Retry-After': String(retryAfter),
  })
  res.end(RATE_LIMIT_BODY)
}

/**
 * 创建回环 shim。`server.listen(0, '127.0.0.1')` 在返回前就发出，
 * `ready` 在端口确定后 resolve；`baseUrl()` 逐次读 `server.address()`，
 * 所以 adapter 每次构建模型描述符时都能拿到最终端口。
 */
export function createShim(options: CatpawShimOptions): CatpawShim {
  const secret = randomBytes(32).toString('base64url')
  const secretBuf = Buffer.from(secret)
  const log = options.logger ?? (() => {})
  const bodyLimit = options.requestBodyLimit ?? REQUEST_BODY_LIMIT
  const makeLongcat = options.createLongcat ?? createLongcatClient
  const makeChannelB = options.createChannelB ?? createChannelBUpstream

  let baseUrlValue = ''
  let portValue = 0
  let closeFn: () => Promise<void> = async () => {}

  const ready = new Promise<void>((resolveReady, rejectReady) => {
    const server = createServer((req, res) => {
      // 客户端断连的取消：监听 res 的 close（req 的 close 在 readBody 读完流后
      // 立刻触发，之后注册的监听器永远不会触发）。
      const controller = new AbortController()
      res.on('close', () => {
        if (!res.writableEnded) controller.abort()
      })
      void handleRequest(req, res, controller.signal).catch((error: unknown) => {
        const raw = String((error as Error)?.message ?? 'internal error')
        writeJson(res, 500, { error: { message: raw, code: 'internal_error', type: 'shim_error' } })
      })
    })

    server.on('error', rejectReady)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      baseUrlValue = `http://127.0.0.1:${addr.port}`
      portValue = addr.port
      resolveReady()
    })

    closeFn = () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  /** 官方通道客户端惰性构造（apiKey 只在这里取，不写日志、不回显）。 */
  function longcat(): LongcatClient {
    const key = options.apiKey()
    if (key === undefined || key === '') {
      throw new Error('未配置 LongCat API Key：请在插件设置里填写，或设置环境变量')
    }
    const init: { apiKey: string; fetchFn?: typeof fetch } = { apiKey: key }
    if (options.fetchFn !== undefined) init.fetchFn = options.fetchFn
    return makeLongcat(init)
  }

  /** B 通道 upstream 惰性构造（测试可经 `createChannelB` 注入替身）。 */
  function channelB(): ChannelBUpstream {
    const init: { fetchFn?: typeof fetch } = {}
    if (options.fetchFn !== undefined) init.fetchFn = options.fetchFn
    return makeChannelB(init)
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse, signal: AbortSignal): Promise<void> {
    // 三重入站校验 + bearer 常量时间比对：必须在路由判定之前执行，否则
    // /healthz 之类的路径也会被拿来探活。
    if (!checkHost(req)) {
      writeJson(res, 403, { error: { message: 'bad host', code: 'host_not_allowed' } })
      return
    }
    if (!originIsLoopback(req.headers.origin)) {
      writeJson(res, 403, { error: { message: 'Origin must be a loopback origin', code: 'origin_not_allowed' } })
      return
    }
    if (!checkAuthorization(req, secretBuf)) {
      writeJson(res, 401, { error: { message: 'invalid api key', code: 'invalid_api_key' } })
      return
    }
    if (!checkContentType(req)) {
      writeJson(res, 415, { error: { message: 'unsupported media type', code: 'invalid_request_error' } })
      return
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/healthz/')) {
      writeJson(res, 200, { ok: true })
      return
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      await handleChat(req, res, signal)
      return
    }
    writeJson(res, 404, { error: { message: 'not found', code: 'invalid_request_error' } })
  }

  async function handleChat(req: IncomingMessage, res: ServerResponse, signal: AbortSignal): Promise<void> {
    let raw: string
    try {
      raw = await readBody(req, bodyLimit)
    } catch (error) {
      if ((error as Error).message === 'request body too large') {
        writeJson(res, 413, { error: { message: 'request body too large', code: 'invalid_request_error' } })
        return
      }
      throw error
    }

    let body: Record<string, unknown>
    try {
      body = JSON.parse(raw) as Record<string, unknown>
    } catch {
      writeJson(res, 400, { error: { message: 'invalid JSON body', code: 'invalid_request_error' } })
      return
    }

    // 按前缀分流：官方前缀转发 LongCat；妙手前缀走本地 Agent Server。
    const modelId = typeof body.model === 'string' ? body.model : ''
    const channel = channelOf(modelId)

    if (channel === 'catpaw') {
      // 阶段二：接入本地 Agent Server（施工队模式）。
      // 工作目录：优先显式字段，其次从宿主注入的 system prompt 里提取（0.2.1 修复）。
      const upstream = channelB()
      const chatRequest: ChannelBChatRequest = {
        workingDir: extractWorkingDir(body),
        text: extractUserText(body),
        signal,
      }
      if (typeof body.conversationId === 'string') chatRequest.conversationId = body.conversationId
      const result = await upstream.chat(chatRequest)
      // 🔴 无论成功失败都用 SSE 输出：DSH 按流式解析，裸 JSON 会触发
      //    `Stream ended without finish_reason`（0.2.0 的根因之一）。
      streamChannelBResult(res, result, wantsStream(body))
      return
    }
    if (channel !== 'longcat') {
      writeJson(res, 404, { error: { message: 'unknown model channel', code: 'invalid_request_error' } })
      return
    }

    // 官方侧：把 Config.thinkLongcat 作为第三参传入，F9「深度思考」开关在此生效。
    // chat() 负责注入 thinking 字段并透传 stream；shim 只转发其响应（含 SSE）。
    try {
      const thinkLongcat = options.thinkLongcat()
      // **必须剥掉 `longcat/` 前缀再发给官方。** 前缀只是 DSH 模型选择器里的
      // 路由标记，官方 API 只认裸模型 id：带着前缀请求会被拒
      // （400 `invalid_parameter` / `Unsupported model (model=longcat/LongCat-2.0)`）。
      // `stripPrefix` 之前只定义没被调用，就是这个 400 的根因。
      const upstreamBody: Record<string, unknown> = {
        ...body,
        model: stripPrefix(modelId),
      }
      const upstream = await longcat().chat(upstreamBody, signal, thinkLongcat)

      if (isFreshRateLimit(upstream)) {
        // 🔴 429 归一化：读上游体拿 retry_after，提示，再写回宿主可归类的 429。
        //    不抛 error（shim 的 catch 会把它变成 502，到不了宿主）；
        //    不自己重试（宿主 dsh-llm-retry 已有 5 次 / 指数退避，重复造轮子会叠成 5×6）。
        const raw = await upstream.clone().text().catch(() => '')
        log(`catpaw longcat rate limited (429): retry_after=${parseRetryAfter(raw) ?? 'none'}`)
        // 读空原 body，避免连接泄漏；随后写归一化响应。
        await upstream.text().catch(() => {})
        writeRateLimitResponse(res, raw)
        return
      }

      forwardUpstream(res, upstream)
    } catch (error) {
      const message = String((error as Error)?.message ?? 'upstream error')
      // 脱敏：任何日志/错误都不回显 apiKey 本身。
      log(`longcat upstream error: ${message.replace(/pt-[A-Za-z0-9]+/g, '[redacted]')}`)
      writeJson(res, 502, { error: { message: 'upstream error', code: 'upstream_error', type: 'shim_error' } })
    }
  }

  /**
   * 把 B 通道结果按 OpenAI **流式**形状写给宿主。
   *
   * 为什么必须流式：DSH 用 `stream:true` 请求并按 SSE 解析，收到裸 JSON 时会报
   * `Stream ended without finish_reason`。失败也走同一形状（带 `error` 帧），
   * 否则宿主同样解析不到 `finish_reason`。
   */
  function streamChannelBResult(
    res: ServerResponse,
    result: Awaited<ReturnType<ReturnType<typeof createChannelBUpstream>['chat']>>,
    streaming: boolean,
  ): void {
    if (res.writableEnded || res.destroyed) return

    const created = Math.floor(Date.now() / 1000)
    const id = `chatcmpl-${Date.now()}`

    // 非流式请求（少数客户端）：直接回一次性 JSON，但仍带 finish_reason。
    if (!streaming) {
      if (!result.ok) {
        log(`catpaw channel unavailable: ${result.error ?? 'unknown'}`)
        writeJson(res, 200, {
          error: { code: 'CHANNEL_B_UNAVAILABLE', message: result.error ?? '通道 B 不可用' },
        })
        return
      }
      writeJson(res, 200, {
        id,
        object: 'chat.completion',
        created,
        model: result.modelName || CATPAW_MODEL_NAME,
        choices: [{ index: 0, message: { role: 'assistant', content: result.text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      })
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const send = (payload: unknown): void => {
      if (res.writableEnded || res.destroyed) return
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }
    const finish = (): void => {
      if (res.writableEnded || res.destroyed) return
      res.write('data: [DONE]\n\n')
      res.end()
    }

    if (!result.ok) {
      log(`catpaw channel unavailable: ${result.error ?? 'unknown'}`)
      send({ error: { code: 'CHANNEL_B_UNAVAILABLE', message: result.error ?? '通道 B 不可用' } })
      finish()
      return
    }

    const model = result.modelName || CATPAW_MODEL_NAME
    // 单块正文：妙手已经一次性拿到完整文本，这里按 DSH 期望的形状吐出即可。
    if (result.text !== '') {
      send({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: { content: result.text }, finish_reason: null }],
      })
    }
    send({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })
    finish()
  }

  /** 请求体是否要求流式（缺省按 true：DSH 一律流式）。 */
  function wantsStream(body: Record<string, unknown>): boolean {
    return body.stream !== false
  }

  /** 把官方客户端的响应（含 SSE 流）转回 OpenAI 客户端。 */
  function forwardUpstream(res: ServerResponse, upstream: Response): void {
    if (res.writableEnded || res.destroyed) return
    const headers: Record<string, string> = {}
    upstream.headers.forEach((value, key) => { headers[key] = value })
    res.writeHead(upstream.status, headers)
    // 已消费过的 Response（异常构造）无法再读 body，直接收尾，避免出现
    // 「headers sent 之后再次写头」的二次响应错误。
    if (upstream.body === null || upstream.bodyUsed) {
      res.end()
      return
    }
    const reader = upstream.body.getReader()
    const pump = (): void => {
      void reader.read().then(({ done, value }) => {
        if (done) { if (!res.writableEnded) res.end(); return }
        if (res.destroyed) { void reader.cancel(); return }
        if (!res.write(value)) {
          res.once('drain', pump)
        } else {
          pump()
        }
      }).catch(() => { if (!res.writableEnded) res.end() })
    }
    pump()
  }

  return {
    ready,
    baseUrl: () => baseUrlValue,
    token: () => secret,
    close: async () => { await closeFn() },
  }
}
