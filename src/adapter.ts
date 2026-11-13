/**
 * pi-ai provider 组装：把回环 shim 包成一个 DSH 可注册的 `PiAiAdapter`。
 *
 * 以 qoder `src/adapter.ts` 为**结构参照**独立重写（未复制其源码）：
 * - `createProvider({ id: PROVIDER_ROUTE, api: openAICompletionsApi(),
 *   models: buildModels(), ... })`：模型描述符的 `baseUrl` 逐次读
 *   `shim.baseUrl()`，所以随机端口在第一次快照时就生效；
 * - `getModels` 委托给「活读」，目录刷新立刻生效；
 * - `new PiAiAdapter({ resolveApiKey: () => shim.token(), auth: INERT_AUTH, ... })`：
 *   pi-ai 全程走 inert 凭据生命周期，只拿 shim 的进程内 secret 当 apiKey；
 * - `piAiRuntimeInfo()` 世代门控：阶段一固定 `'modern'`。
 *
 * 阶段一边界（硬）：
 * - `buildModels()` 只取官方前缀（`longcat/`）模型，目录 = `LONGCAT_CATALOG_FALLBACK`
 *   与运行时 `listModels()` 结果合并去重；
 * - **不含 catpaw 模型、不含档位/思考字段**（不写 `reasoning` / `thinkingLevelMap`
 *   / `contextTiers`，不注册任何档位到聊天界面槽位）；
 * - 不臆测宿主 pi-ai 世代，阶段三按宿主实测再校准。
 *
 * @module dsh-connect-catpaw/adapter
 */

import { createProvider } from '@earendil-works/pi-ai'
import type { Api, AuthContext, CredentialStore, Model, Provider } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { CatalogEntry } from './contracts.ts'
import { CATPAW_CATALOG, isChannelBEnabled, PROVIDER_ROUTE } from './routing.ts'
import { LONGCAT_CATALOG_FALLBACK } from './routing.ts'
import type { CatpawShim } from './shim.ts'

/**
 * Provider route 与显示名（DSH 模型选择器）。
 *
 * `CATPAW_PROVIDER_DISPLAY_NAME` 是选择器里那一组的**分组标题**
 * （`registerConfigurableProviders` 的 `displayName` → 宿主 `group.name`）。
 * 模型行本身显示的是 `model.name`（= 带前缀的 `info.id`），两者不是一个东西。
 *
 * `CATPAW_PROVIDER` 是路由键，**永不改名** —— 改了 provider 就注册不上，
 * 已存的模型选择也会全部失效。
 */
export const CATPAW_PROVIDER = PROVIDER_ROUTE
export const CATPAW_PROVIDER_DISPLAY_NAME = 'catpaw2dsh'

/** 流空闲上限，对齐 qoder/workbuddy 同款 300s。 */
export const CATPAW_STREAM_IDLE_TIMEOUT_MS = 300_000

/** 订阅额度无从定价：cost 全 0。 */
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/**
 * 图像请求预算（dsh-llm-pi-ai 默认值）。本插件手工组装 profile，不经过宿主的
 * `resolveProfile`，故这些「必填」字段必须显式给出，否则整条 route 缺省计数边界。
 * 数值对齐宿主 0.2.2-rc.1 的默认值。
 */
const REQUEST_IMAGE_BUDGETS = {
  maxRequestImageBytes: 20_971_520,
  requestImagePixelBudget: 4_194_304,
  requestImageMaxBytes: 1_048_576,
  maxRequestImages: 50,
  imageOffloadCountQuantum: 10,
} as const

/**
 * Inert pi-ai auth plane：本 route 只通过 shim secret 认证，pi-ai 自己的凭据
 * 发现/持久化机制一律不参与（否则 secret 会被写进环境凭据存储，传播边界就散了）。
 */
const INERT_AUTH: { credentials: CredentialStore; authContext: AuthContext } = {
  credentials: {
    async read() { return undefined },
    async list() { return [] },
    async modify() {},
  },
  authContext: {},
} as unknown as { credentials: CredentialStore; authContext: AuthContext }

/** pi-ai 世代（阶段一固定 modern；modern 分支对 api 是直通，不折 transcript）。 */
export type PiAiGeneration = 'modern' | 'legacy'

/**
 * pi-ai 世代门控。
 *
 * 阶段一**固定** `'modern'`：qoder 的 `piAiRuntimeInfo()` 用 `import.meta.resolve`
 * 探测实际解析到的 pi-ai manifest 版本，legacy(0.85) 才需要把归一化的 transcript
 * 折回扁平形态。本阶段不臆测宿主实际版本，也不做版本探测——
 * **阶段三按宿主实测再校准**（若宿主实测为 legacy，再补 `withLegacyContext` 的
 * 0.85 折叠分支）。modern 分支即直通，不引入任何上下文改写。
 */
export function piAiRuntimeInfo(): { generation: PiAiGeneration } {
  return { generation: 'modern' }
}

/**
 * 世代门控的 api 包装。阶段一 modern = 原样返回（`openAICompletionsApi()`），
 * 不改写 transcript；legacy 折叠留到阶段三按实测补上。
 */
function withLegacyContext(api: ReturnType<typeof openAICompletionsApi>, generation: PiAiGeneration): ReturnType<typeof openAICompletionsApi> {
  if (generation === 'legacy') {
    // 阶段三按宿主实测再校准：此处才需要 0.85 的 systemPrompt/tools 折叠。
    return api
  }
  return api
}

export interface CatpawAdapterOptions {
  shim: CatpawShim
  /** 运行时目录（活读）：index.ts 异步 `listModels()` 刷新后写到这里。 */
  liveModels?: () => CatalogEntry[]
  /** 覆盖 provider id（缺省 PROVIDER_ROUTE）。 */
  provider?: string
  /** 覆盖显示名。 */
  displayName?: string
  /** 可选附件存储（缺省不注入）。 */
  resolveAttachments?: () => AttachmentStore | undefined
}

export interface CatpawAdapter {
  adapter: PiAiAdapter
  /** 目录刷新后调用：替换 profiles 快照强制重建。 */
  invalidate: () => void
  /** 诊断用：本 checkout 解析到的 pi-ai 世代。 */
  piAiGeneration: PiAiGeneration
}

/**
 * 官方目录合成：静态 fallback 与运行时 `listModels()` 合并，按 id 去重。
 * 只保留官方前缀（`provider === 'longcat'`），**绝不**让 catpaw 占位模型进入
 * DSH 的模型选择器；档位字段在此被彻底丢弃（F10 只针对通道 B）。
 */
function officialCatalog(liveModels: () => CatalogEntry[]): CatalogEntry[] {
  const merged = new Map<string, CatalogEntry>()
  for (const entry of LONGCAT_CATALOG_FALLBACK) merged.set(entry.id, entry)
  for (const entry of liveModels()) {
    if (entry.provider !== 'longcat') continue
    merged.set(entry.id, entry)
  }
  return [...merged.values()]
}

/** 把一个官方 CatalogEntry 映射成 pi-ai 模型描述符（不含任何档位/思考字段）。 */
export function toPiModel(info: CatalogEntry, baseUrl: string, providerId: string): Model<Api> {
  return {
    id: info.id,
    // 显示名用带前缀的 id：宿主模型选择器渲染的是 `model.name`
    // （packages/client/ui-model-selection/src/client/index.ts:59 → label: model.name），
    // 而 `info.id` 已是 `longcat/LongCat-2.5` 规范形式 —— 用它既带上前缀，
    // 又保证显示名与路由键永远一致。**只改显示名，路由键 id 不动。**
    name: info.id,
    api: 'openai-completions',
    provider: providerId,
    baseUrl,
    input: info.input,
    cost: NO_COST,
    contextWindow: info.contextWindow,
    maxTokens: info.maxTokens,
    // 阶段一不声明推理/档位：不写 reasoning / thinkingLevelMap。
    // 官方「深度思考」是 chat() 注入 thinking 的二值开关（F9），
    // 不是 DSH 的多档推理等级，不能在这里映射成档位。
    reasoning: false,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsMidConvoSystemMessages: false,
    },
  } as unknown as Model<Api>
}

/**
 * 组装适配器。`getModels` 委托活读，使目录刷新立刻生效；baseUrl 逐次重新
 * 解析，保证 shim 的临时端口在第一个快照时就正确。
 */
export function createAdapter(options: CatpawAdapterOptions): CatpawAdapter {
  const { shim } = options
  const providerId = options.provider ?? CATPAW_PROVIDER
  const providerName = options.displayName ?? CATPAW_PROVIDER_DISPLAY_NAME
  const liveModels = options.liveModels ?? (() => [])

  const generation = piAiRuntimeInfo().generation
  const api = withLegacyContext(openAICompletionsApi(), generation)

  const buildModels = (): Model<Api>[] => {
    const baseUrl = `${shim.baseUrl()}/v1`
    const official = officialCatalog(liveModels).map(info => toPiModel(info, baseUrl, providerId))
    // 阶段二：B 通道单一模型（免费 LongCat-2.5）。名字走 routing.ts 的唯一来源。
    const channelB = isChannelBEnabled()
      ? CATPAW_CATALOG.map(info => toPiModel(info, baseUrl, providerId))
      : []
    return [...official, ...channelB]
  }

  const base = createProvider({
    id: providerId,
    name: providerName,
    // 必须返回「对象」而非 undefined：pi-ai 的 applyAuth 只做存在性判断，
    // 返回 undefined 等于宣称 provider 未配置，用户会看到
    // 「Provider is not configured」。真实凭据不从这里来，只走 shim secret。
    auth: {
      apiKey: {
        name: 'Catpaw shim token',
        async resolve({ credential }) {
          const apiKey = credential?.key
          return {
            auth: apiKey === undefined || apiKey.length === 0 ? {} : { apiKey },
            source: 'Catpaw shim token',
          }
        },
      },
    },
    models: buildModels(),
    api,
  })

  // getModels 活读：流分发仍走已构造的 provider，目录答案跟随刷新。
  const provider: Provider = { ...base, getModels: () => buildModels() }

  const profile: ResolvedPiAiProviderProfile = {
    provider: providerId,
    displayName: providerName,
    streamIdleTimeoutMs: CATPAW_STREAM_IDLE_TIMEOUT_MS,
    retryPolicy: resolveRetryPolicy(undefined, 'dsh-connect-catpaw retryPolicy'),
    configuredMaxTokens: new Map(),
    modelErrors: new Map(),
    ...REQUEST_IMAGE_BUDGETS,
    // 本仓直接依赖的 @earendil-works/pi-ai 与 dsh-llm-pi-ai 内部解析到的 pi-ai
    // 可能是不同版本（compat 联合成员不同），两份结构化类型互不兼容；这里按
    // profile 自身的 piProvider 类型做一次边界桥接，运行时对象形状完全一致。
    piProvider: provider as unknown as NonNullable<ResolvedPiAiProviderProfile['piProvider']>,
  }

  let profiles = new Map<string, ResolvedPiAiProviderProfile>([[providerId, profile]])

  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    auth: INERT_AUTH,
    // BLUEPRINT §2.3：async () => shim.token()（返回 Promise<string | undefined>）。
    resolveApiKey: async () => shim.token(),
    ...(options.resolveAttachments === undefined ? {} : { resolveAttachments: options.resolveAttachments }),
  })

  return {
    adapter,
    invalidate: () => {
      profiles = new Map<string, ResolvedPiAiProviderProfile>([[providerId, profile]])
    },
    piAiGeneration: generation,
  }
}
