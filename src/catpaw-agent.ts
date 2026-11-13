/**
 * 妙手本地 Agent Server 客户端（发现 / 配置 / 对话 / SSE 解析）。
 *
 * 职责边界：本文件只负责「和本地妙手 Agent Server 说话」——
 *   - `discoverAgentServer()`：扫本机回环端口，找出妙手客户端的 Agent Server；
 *   - `configureFreeModel()`：把服务端配置指向免费的 LongCat-2.5；
 *   - `startChat()`：发一轮 `agent.start` 并把 SSE 事件收敛成结构化结果。
 *
 * 上层编排（发现 → 配置 → 对话 的顺序、失败文案、状态探测）在 `channel-b.ts`；
 * 本文件**不** import 任何项目内模块（除 `routing.ts` 的两个常量），避免循环依赖。
 *
 * 三条硬约束（都来自实测，见 temp/P2/probe-report.md）：
 *   1. `PATCH /api/admin/config` 只认 8 个键，本插件**只写 `model` 一个**——
 *      多写会污染妙手的合法配置，且 `PATCH` 没有删键语义，写坏了只能逐一改回。
 *   2. 工作目录靠请求头 `x-catpaw-directory: encodeURIComponent(<绝对路径>)` 传递；
 *      **缺失时必须直接拒绝**，绝不能"退回不传目录"——那样妙手会在自己的安装
 *      目录里干活，用户看到的是完全不相干的文件。
 *   3. 妙手自带的 27 个工具无法禁用，因此工具调用事件必须收进 `toolEvents`
 *      供上层审计。
 *
 * 所有导出函数**都不抛异常**：失败一律通过返回值（`null` / `false` / `ok:false`）表达。
 *
 * @module dsh-connect-catpaw/catpaw-agent
 */

import { randomUUID } from 'node:crypto'
import { CATPAW_FREE_MODEL_ID, CATPAW_MODEL_NAME } from './routing.ts'

/** 本地 Agent Server 句柄。 */
export interface CatpawAgentServer {
  /** 形如 'http://127.0.0.1:6984'。 */
  baseUrl: string
}

/** 一轮对话的结果（成功与失败共用同一形状，失败看 `ok` / `error`）。 */
export interface CatpawChatResult {
  ok: boolean
  /** 拼好的助手文本（model_chunk 累加）。 */
  text: string
  /** model_end.message.modelDisplayName。 */
  modelName: string
  /** agent_end.roundInfo.creditCost。 */
  creditCost: string
  /** 审计用：本次妙手执行过的工具（名+参数+输出）。 */
  toolEvents: Array<{ type: string; toolName: string; args?: unknown; output?: unknown }>
  /** 失败原因（ok=false 时必有）。 */
  error?: string
}

/** 回环地址：只和本机的妙手客户端说话。 */
const LOOPBACK_HOST = '127.0.0.1'

/** 端口扫描范围（含两端）：妙手每次启动端口动态，实测出现过 6984 / 6985。 */
const PORT_RANGE_FIRST = 6983
const PORT_RANGE_LAST = 6990

/** 单端口探测超时：端口没监听时 TCP 会立刻失败，超时只防"连上了但不回话"。 */
const DISCOVERY_TIMEOUT_MS = 1000

/** 进程/端口查询超时：PowerShell 启动通常 200~800ms，给足余量但不拖死首屏。 */
const PROCESS_QUERY_TIMEOUT_MS = 5000

/** 妙手 Agent Server 的首页横幅，用来确认这个端口确实是它（而不是别的本地服务）。 */
const SERVER_BANNER = 'CatPaw Agent Server'

/** 缺失工作目录的拒绝文案：明确说"需要工作目录"，不是泛泛的失败。 */
const WORKDIR_REQUIRED_ERROR = '通道 B 需要工作目录（会话工作区缺失），已拒绝调用'

/** 取出可调用对象：`fetchFn` 缺省时用全局 fetch（Node 18+ 自带）。 */
function resolveFetch(fetchFn: typeof fetch | undefined): typeof fetch {
  return fetchFn ?? fetch
}

/** 把任意值收窄成「非 null 对象」，用于解析上游 JSON（上游形状不可信）。 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return value as Record<string, unknown>
}

/**
 * 发现本地 Agent Server：扫 127.0.0.1 的 [6983..6990]，
 * `GET /` 返回含 'CatPaw Agent Server' 者胜出。
 *
 * 顺序扫描而非并发：端口通常第一个或第二个就命中，并发只会把「妙手没开」这一
 * 常见情况的 8 个连接同时打出去，得不偿失。
 *
 * @param fetchFn - 可注入的 fetch（测试替身）；缺省用全局 fetch。
 * @returns 命中则返回句柄，否则 `null`（不抛错）。
 */
export function discoverAgentServer(fetchFn?: typeof fetch): Promise<CatpawAgentServer | null> {
  // 非 async 的导出壳：契约签名是 `Promise`，且这里再兜一层 catch，
  // 保证连"同步抛出"（例如 fetch 被替换成会抛的实现）也不会漏到上层。
  return discoverAgentServerImpl(fetchFn).catch(() => null)
}

/** {@link discoverAgentServer} 的实现体。 */
async function discoverAgentServerImpl(fetchFn?: typeof fetch): Promise<CatpawAgentServer | null> {
  const doFetch = resolveFetch(fetchFn)
  // 候选端口 = 进程定位到的端口（优先）∪ 静态兜底段。
  // 为什么不能只扫固定段：妙手每次启动端口都变，实测出现过 6984/6985，
  // 也出现过 8553/9465/14608 —— 后者完全在 6983..6990 之外。
  const candidates = await collectCandidatePorts()
  for (const port of candidates) {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, DISCOVERY_TIMEOUT_MS)
    try {
      const response = await doFetch(`http://${LOOPBACK_HOST}:${port}/`, { signal: controller.signal })
      // 不看 status：只要响应体带横幅就认，避免不同版本用不同状态码挡在前面。
      const body = await response.text()
      if (body.includes(SERVER_BANNER)) {
        return { baseUrl: `http://${LOOPBACK_HOST}:${port}` }
      }
    } catch {
      // 端口未监听 / 超时 / 读到一半断开：换下一个端口。
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

/**
 * 汇总候选端口：**先按进程精确定位**，再补静态兜底段。
 *
 * 本机通常有几十个回环监听端口（实测 59 个），逐个探横幅太慢且会误触别的本地服务；
 * 按 `catpaw-cli` 的 PID 过滤能把候选收敛到 1~3 个。进程查询失败（非 Windows、
 * 权限不足、命令不可用）时退回静态段，保证仍有机会命中。
 */
async function collectCandidatePorts(): Promise<number[]> {
  const discovered = await queryPortsOfCatpawProcess()
  const ordered: number[] = []
  const seen = new Set<number>()
  for (const port of discovered) {
    if (!seen.has(port)) { seen.add(port); ordered.push(port) }
  }
  for (let port = PORT_RANGE_FIRST; port <= PORT_RANGE_LAST; port += 1) {
    if (!seen.has(port)) { seen.add(port); ordered.push(port) }
  }
  return ordered
}

/**
 * 通过进程名找到妙手 Agent Server 的监听端口（Windows 专用）。
 *
 * 用 PowerShell 一次性完成"找 PID → 查监听端口"，避免多次进程启动开销。
 * 任何失败都返回空数组（由 {@link collectCandidatePorts} 回落静态段）。
 */
async function queryPortsOfCatpawProcess(): Promise<number[]> {
  if (process.platform !== 'win32') return []
  const script = [
    '$pids = @(Get-Process -Name catpaw-cli -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)',
    'if ($pids.Count -eq 0) { exit 0 }',
    'Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |',
    '  Where-Object { $pids -contains $_.OwningProcess } |',
    '  Select-Object -ExpandProperty LocalPort -Unique',
  ].join('\n')
  try {
    const { execFile } = await import('node:child_process')
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: PROCESS_QUERY_TIMEOUT_MS, windowsHide: true },
        (error, out) => {
          if (error !== null) { reject(error); return }
          resolve(out)
        },
      )
    })
    const ports: number[] = []
    for (const line of stdout.split(/\r?\n/)) {
      const value = Number.parseInt(line.trim(), 10)
      if (Number.isInteger(value) && value > 0 && value <= 65535) ports.push(value)
    }
    return ports
  } catch {
    // 命令不可用 / 超时 / 无进程：交给调用方回落。
    return []
  }
}

/**
 * 指定免费模型（唯一允许写 `model` 一个键）。
 *
 * **为什么 404 算成功**：妙手只在「有活跃 agent」时才允许 `GET /api/config`；
 * 设置页做状态检测时根本没有会话，所以必然返回
 * `404 {"error":"No active agent found for config query"}`。
 * 这是妙手的正常行为，不是配置失败 —— 0.2.0 把它当失败，导致设置页永远显示"未就绪"。
 *
 * 判定规则：
 * - PATCH 非 2xx → 失败；
 * - `GET /api/config` 返回 **404 → 成功**（无活跃会话，PATCH 已接受）；
 * - `GET /api/config` 返回 200 且 `model` 与期望不符 → 失败；
 * - `GET /api/config` 网络异常 → 只要 PATCH 成功就判成功（读回是加分项，不是必需）。
 *
 * @param server - 已发现的 Agent Server。
 * @param fetchFn - 可注入的 fetch（测试替身）；缺省用全局 fetch。
 * @returns `true` = 已应用且读回确认；`false` = 失败（不抛错）。
 */
export function configureFreeModel(
  server: CatpawAgentServer,
  fetchFn?: typeof fetch,
): Promise<boolean> {
  return configureFreeModelImpl(server, fetchFn).catch(() => false)
}

/** {@link configureFreeModel} 的实现体。 */
async function configureFreeModelImpl(
  server: CatpawAgentServer,
  fetchFn?: typeof fetch,
): Promise<boolean> {
  const doFetch = resolveFetch(fetchFn)
  try {
    const patched = await doFetch(`${server.baseUrl}/api/admin/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // 🔴 只写这一个键。多加任何键都会污染妙手的合法配置（PATCH 无删键语义）。
      body: JSON.stringify({ model: CATPAW_FREE_MODEL_ID }),
    })
    if (!patched.ok) return false

    // 读回确认是**加分项**，不是必需：无活跃会话时妙手会回 404，属正常。
    let current: Response
    try {
      current = await doFetch(`${server.baseUrl}/api/config`)
    } catch {
      // 读回本身失败（连接抖动）：PATCH 已成功，判成功。
      return true
    }
    if (current.status === 404) return true   // 「No active agent」——正常
    if (!current.ok) return true              // 其它非 2xx 也不推翻已成功的 PATCH

    const document = asRecord(await current.json().catch(() => undefined))
    // 只有"确实读到了配置且 model 不符"才算失败。
    if (document === undefined || !('model' in document)) return true
    return document.model === CATPAW_FREE_MODEL_ID
  } catch {
    // PATCH 阶段就失败（网络/服务退出）：算没配置成功。
    return false
  }
}

/**
 * 发一轮对话。
 *
 * 目录守卫在最前面：`workingDir` 缺失时**零网络请求**直接返回错误。这条不是
 * 防御性编程，而是行为契约——不带目录的请求会让妙手在它自己的安装目录里执行
 * 工具，用户会看到完全不相关的文件列表，却以为"通道坏了"。
 *
 * @param options - 见 {@link startChat} 的字段说明。
 * @returns 统一形状的结果；不抛错。
 */
export function startChat(options: {
  server: CatpawAgentServer
  /** 🔴 必填：DSH 会话工作区绝对路径；缺失时直接返回错误，绝不发请求。 */
  workingDir: string | undefined
  /** 用户消息文本（已由调用方从 messages[] 提取）。 */
  text: string
  /** 会话标识；缺省自动生成。 */
  conversationId?: string
  signal?: AbortSignal
  fetchFn?: typeof fetch
}): Promise<CatpawChatResult> {
  return startChatImpl(options).catch((error: unknown): CatpawChatResult => ({
    ok: false,
    text: '',
    modelName: '',
    creditCost: '',
    toolEvents: [],
    error: error instanceof Error ? error.message : '通道 B 调用失败',
  }))
}

/** {@link startChat} 的实现体。 */
async function startChatImpl(options: {
  server: CatpawAgentServer
  /** 🔴 必填：DSH 会话工作区绝对路径；缺失时直接返回错误，绝不发请求。 */
  workingDir: string | undefined
  /** 用户消息文本（已由调用方从 messages[] 提取）。 */
  text: string
  /** 会话标识；缺省自动生成。 */
  conversationId?: string
  signal?: AbortSignal
  fetchFn?: typeof fetch
}): Promise<CatpawChatResult> {
  const { server, workingDir, text } = options

  // —— 目录守卫：必须在任何 fetch 之前 ——
  if (!workingDir || workingDir.trim() === '') {
    return {
      ok: false,
      text: '',
      modelName: '',
      creditCost: '',
      toolEvents: [],
      error: WORKDIR_REQUIRED_ERROR,
    }
  }

  const doFetch = resolveFetch(options.fetchFn)
  const conversationId = options.conversationId ?? randomUUID()
  const result: CatpawChatResult = {
    ok: true,
    text: '',
    modelName: '',
    creditCost: '',
    toolEvents: [],
  }

  try {
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        // 绝对路径经 encodeURIComponent 编码：请求头只能是 ASCII，中文路径尤其需要。
        'x-catpaw-directory': encodeURIComponent(workingDir),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'agent.start',
        stream: true,
        params: {
          // 妙手的 content 只接受 {type:'text', text}；tool_result 之类一律 invalid_union。
          content: [{ type: 'text', text }],
          conversationId,
        },
        id: randomUUID(),
      }),
    }
    if (options.signal !== undefined) init.signal = options.signal

    const response = await doFetch(`${server.baseUrl}/api`, init)

    if (!response.ok) {
      result.ok = false
      result.error = `本地 Agent Server 返回 HTTP ${response.status}`
      return result
    }

    if (response.body === null) {
      // 理论上 SSE 一定有 body；退化成整段解析，仍然按行处理。
      handleSseText(await response.text(), result)
    } else {
      await consumeSseStream(response.body, result)
    }
  } catch (error: unknown) {
    result.ok = false
    const message = error instanceof Error ? error.message : ''
    result.error = message === '' ? '通道 B 调用失败' : message
    return result
  }

  // 上游偶尔不吐 model_end：回落到 B 通道模型名的唯一来源，避免上层回一个空 model 字段。
  if (result.ok && result.modelName === '') result.modelName = CATPAW_MODEL_NAME
  return result
}

/** 逐行消费 SSE 流（`data: ` 前缀 + JSON-RPC 信封）。 */
async function consumeSseStream(
  stream: ReadableStream<Uint8Array>,
  result: CatpawChatResult,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    buffer = drainLines(buffer, result)
  }
  buffer += decoder.decode()
  handleSseLine(buffer.replace(/\r$/, ''), result)
}

/** 把整段文本按行喂给同一个行处理器（无流式 body 时的退化路径）。 */
function handleSseText(text: string, result: CatpawChatResult): void {
  let buffer = text
  buffer = drainLines(buffer, result)
  if (buffer !== '') handleSseLine(buffer.replace(/\r$/, ''), result)
}

/**
 * 从缓冲区里切出所有完整行并处理，返回剩下的不完整尾巴。
 *
 * SSE 的一行可能被 TCP 切成两段，所以必须按 `\n` 缓冲，不能按 chunk 直接 parse。
 */
function drainLines(buffer: string, result: CatpawChatResult): string {
  let rest = buffer
  let index = rest.indexOf('\n')
  while (index >= 0) {
    const line = rest.slice(0, index).replace(/\r$/, '')
    rest = rest.slice(index + 1)
    handleSseLine(line, result)
    index = rest.indexOf('\n')
  }
  return rest
}

/**
 * 处理一行 SSE。
 *
 * 信封形状（实测）：`data: {"jsonrpc":"2.0","id":"<uuid>","event":{...}}`。
 * `event` 里的业务字段有两种历史形态——直接在 `event` 上，或包在 `event.data` 里；
 * 这里统一取「有 data 用 data、没有就用 event 本身」，两种都能解析。
 */
function handleSseLine(line: string, result: CatpawChatResult): void {
  if (!line.startsWith('data: ')) return
  const payload = line.slice(6)
  if (payload === '' || payload === '[DONE]') return

  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return
  }

  const envelope = asRecord(parsed)
  const event = asRecord(envelope?.event)
  if (event === undefined) return

  const type = typeof event.type === 'string' ? event.type : ''
  const data = asRecord(event.data) ?? event

  switch (type) {
    case 'model_chunk': {
      // finished:true 的那一条只是"收尾 + 用量"，不再拼文本。
      if (data.finished === false && typeof data.content === 'string') {
        result.text += data.content
      }
      return
    }
    case 'model_end': {
      const message = asRecord(data.message)
      if (typeof message?.modelDisplayName === 'string') {
        result.modelName = message.modelDisplayName
      }
      return
    }
    case 'agent_end': {
      const roundInfo = asRecord(data.roundInfo)
      if (typeof roundInfo?.creditCost === 'string') {
        result.creditCost = roundInfo.creditCost
      }
      // 非 completed 一律算失败；已由 agent_error 写明原因时不覆盖。
      if (data.reason !== 'completed') {
        result.ok = false
        if (result.error === undefined) {
          result.error = `妙手 Agent 未正常结束（reason: ${String(data.reason ?? 'unknown')}）`
        }
      }
      return
    }
    case 'tool_execution_start':
    case 'tool_execution_result': {
      // 妙手自带工具无法禁用，所以每次工具调用都要留痕，供上层审计。
      const toolEvent: { type: string; toolName: string; args?: unknown; output?: unknown } = {
        type,
        toolName: typeof data.toolName === 'string' ? data.toolName : '',
      }
      if (data.args !== undefined) toolEvent.args = data.args
      if (data.output !== undefined) toolEvent.output = data.output
      result.toolEvents.push(toolEvent)
      return
    }
    case 'agent_error': {
      result.ok = false
      const errorRecord = asRecord(data.error)
      if (typeof data.error === 'string') {
        result.error = data.error
      } else if (typeof errorRecord?.message === 'string') {
        result.error = errorRecord.message
      } else {
        result.error = '妙手 Agent 报错'
      }
      return
    }
    default:
      return
  }
}
