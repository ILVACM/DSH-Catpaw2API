/**
 * 妙手（B 通道）上游 —— 本地 Agent Server 客户端封装。
 *
 * 职责：把 DSH 的 OpenAI 聊天请求翻译成妙手本地 Agent Server 的 `agent.start`
 * 调用，并把结果收敛成 `ChannelBChatResult`（不抛错，统一用 `ok` / `error` 表达）。
 *
 * 阶段二起本文件为真实实现（阶段一的占位导出已整体删除）：
 * - `chat()`：发现服务 → 指定免费模型 → 发一轮对话；
 * - `probe()`：只做可用性探测，供设置页状态展示，**永不抛错**。
 *
 * 网络 / SSE / 目录头等协议细节全部在 `catpaw-agent.ts`，本文件只做编排。
 *
 * 用户可见文案一律「妙手」；技术标识（`catpaw/` 等）原样保留。
 *
 * @module dsh-connect-catpaw/channel-b
 */

import { CATPAW_MODEL_NAME } from './routing.ts'
import { configureFreeModel, discoverAgentServer, startChat } from './catpaw-agent.ts'

export interface ChannelBChatRequest {
  /** DSH 会话工作区绝对路径（必填，缺失即失败）。 */
  workingDir: string | undefined
  /** 用户消息文本。 */
  text: string
  conversationId?: string
  signal?: AbortSignal
}

export interface ChannelBChatResult {
  ok: boolean
  text: string
  modelName: string
  creditCost: string
  toolEvents: Array<{ type: string; toolName: string; args?: unknown; output?: unknown }>
  error?: string
}

/** 未发现本地 Agent Server（妙手客户端没开）。 */
const NO_SERVER_ERROR = '妙手客户端未运行（未发现本地 Agent Server）'

/** 发现了服务但无法指定免费模型（多半是版本不匹配 / 配置接口被拒）。 */
const CONFIG_FAILED_ERROR = '妙手客户端未就绪（免费模型配置失败）'

/** 缺失工作目录：**直接拒绝**，绝不"退回不传目录"。 */
const NO_WORKDIR_ERROR = '通道 B 需要工作目录（会话工作区缺失），已拒绝调用'

/** 构造一个失败结果（字段齐全，`text` / `modelName` 等留空）。 */
function failure(error: string): ChannelBChatResult {
  return { ok: false, text: '', modelName: '', creditCost: '', toolEvents: [], error }
}

/**
 * 创建 B 通道 upstream。
 *
 * @param options.fetchFn 可注入 fetch（测试替身）；缺省用全局 fetch。
 */
export function createChannelBUpstream(options: { fetchFn?: typeof fetch } = {}): {
  chat(request: ChannelBChatRequest): Promise<ChannelBChatResult>
  /** 状态检测：返回 { available, modelName, reason }。 */
  probe(): Promise<{ available: boolean; modelName: string; reason: string }>
} {
  const fetchFn = options.fetchFn

  return {
    async chat(request: ChannelBChatRequest): Promise<ChannelBChatResult> {
      // 目录守卫前置：缺失工作目录时连探测都不做，保证零请求。
      if (request.workingDir === undefined || request.workingDir.trim() === '') {
        return failure(NO_WORKDIR_ERROR)
      }

      // 1) 发现本地 Agent Server（端口动态，探针扫 6983..6990）。
      let server: Awaited<ReturnType<typeof discoverAgentServer>> = null
      try {
        server = await discoverAgentServer(fetchFn)
      } catch {
        server = null
      }
      if (server === null) return failure(NO_SERVER_ERROR)

      // 2) 指定免费模型（只写 `model` 一个键，读回确认）。
      let configured = false
      try {
        configured = await configureFreeModel(server, fetchFn)
      } catch {
        configured = false
      }
      if (!configured) return failure(CONFIG_FAILED_ERROR)

      // 3) 发一轮对话。可选字段按需赋值，避免 exactOptionalPropertyTypes 下传 undefined。
      const chatOptions: Parameters<typeof startChat>[0] = {
        server,
        workingDir: request.workingDir,
        text: request.text,
      }
      if (request.conversationId !== undefined) chatOptions.conversationId = request.conversationId
      if (request.signal !== undefined) chatOptions.signal = request.signal
      if (fetchFn !== undefined) chatOptions.fetchFn = fetchFn

      let result: Awaited<ReturnType<typeof startChat>>
      try {
        result = await startChat(chatOptions)
      } catch (error: unknown) {
        return failure(String((error as Error)?.message ?? '通道 B 调用失败'))
      }

      const mapped: ChannelBChatResult = {
        ok: result.ok,
        text: result.text,
        // 上游没报出模型名时回落到唯一数据源，避免 shim 回一个空 model 字段。
        modelName: result.modelName === '' ? CATPAW_MODEL_NAME : result.modelName,
        creditCost: result.creditCost,
        toolEvents: result.toolEvents,
      }
      if (result.error !== undefined) mapped.error = result.error
      return mapped
    },

    async probe(): Promise<{ available: boolean; modelName: string; reason: string }> {
      // 状态检测绝不抛错：任何异常都折叠成 available:false + reason。
      try {
        const server = await discoverAgentServer(fetchFn)
        if (server === null) {
          return { available: false, modelName: CATPAW_MODEL_NAME, reason: NO_SERVER_ERROR }
        }
        const configured = await configureFreeModel(server, fetchFn)
        if (!configured) {
          return { available: false, modelName: CATPAW_MODEL_NAME, reason: CONFIG_FAILED_ERROR }
        }
        return {
          available: true,
          modelName: CATPAW_MODEL_NAME,
          reason: `本地 Agent Server 已就绪（${server.baseUrl}）`,
        }
      } catch (error: unknown) {
        return {
          available: false,
          modelName: CATPAW_MODEL_NAME,
          reason: String((error as Error)?.message ?? '状态检测失败'),
        }
      }
    },
  }
}
