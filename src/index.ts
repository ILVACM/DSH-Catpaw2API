/**
 * dsh-connect-catpaw 插件入口：宿主侧装配中枢。
 *
 * 装配顺序**逐字按** `temp/dsh-connect-qoder-main/BLUEPRINT.md` §2：
 *   ① createShim（把 config.thinkLongcat 传入）
 *   ② await shim.ready
 *   ③ createAdapter
 *   ④ ctx.llm.registerAdapter([PROVIDER_ROUTE], adapter)
 *   ⑤ ctx.llm.registerConfigurableProviders([...])（一次传完整集合）
 *   ⑥ ctx.llm.registerModelDiscovery(settingsNs, ...)（只返回官方前缀模型）
 *   ⑦ ctx.inject(['settings'], ...) 配 Config（§3.2 唯一导出名）
 *   ⑧ 异步 listModels() 刷新目录
 *   ⑨ 全部 release 挂 ctx.effect(() => () => release())
 *
 * 阶段一边界（硬）：
 * - **不注册**通道 B 前缀模型到选择器（阶段一结束时该前缀不出现在模型选择器）；
 * - **不注册任何档位/思考到聊天界面槽位**（F9/F10 是设置卡内的开关，不是模型元数据）；
 * - 通道 B 全部留白占位，真实逻辑留到阶段二。
 *
 * 宿主 API 的确切签名逐字按 BLUEPRINT §2 抄用；下面 `HostSeams` 只是对那几条
 * 已确证 seam 的**结构化投影**（让并行期隔离 tsc 不依赖宿主模块增强即可通过），
 * 不是新发明的签名。
 *
 * @module dsh-connect-catpaw
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CatalogEntry } from './contracts.ts'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { Config } from './config.ts'
import type { Config as ConfigShape } from './config.ts'
// §3.2 唯一导出名：cordis 从插件模块的 `Config` 具名导出读取 schema。
export { Config } from './config.ts'
export type { Config as ConfigShape } from './config.ts'

/**
 * Cordis 依赖门（Host 半侧）。
 *
 * **`llm` 必须声明。** 本插件在 `apply` 里直接访问 `ctx.llm.registerAdapter` /
 * `registerConfigurableProviders` / `registerModelDiscovery`；Cordis 对未声明
 * 的服务做**抛错式**访问保护（`cannot get property "llm" without inject`），
 * 于是 `apply` 一进来就失败 —— provider 从未注册，模型选择器里自然没有本插件
 * 的模型，而且界面上只表现为"没有选项"，不会红屏。
 *
 * 官方 `llm-pi-ai` 同样写 `export const inject = ['llm']`（宿主源码
 * `packages/llm/llm-pi-ai/src/index.ts:95`），这是这条 seam 的既定写法。
 *
 * `settings` / `webServer` **不**写进来：它们是可选的（`ctx.inject([...])`
 * 软探测），缺席时插件仍应工作（只是设置页/路由降级）。
 */
export const inject = ['llm']

import {
  PLUGIN_ID,
  PROVIDER_ROUTE,
  KEY_ENV_VAR,
  LONGCAT_CATALOG_FALLBACK,
} from './routing.ts'
import { createShim } from './shim.ts'
import { createAdapter } from './adapter.ts'
import { createLongcatClient } from './longcat.ts'
import { registerCatpawWebRoutes } from './web-status.ts'
import { CATPAW_PROVIDER_DISPLAY_NAME } from './adapter.ts'

/** 官方 tab 显示名（与 provider 显示名一致；用户可见文案「妙手」）。 */
const DISPLAY_NAME = CATPAW_PROVIDER_DISPLAY_NAME

/**
 * 宿主 seam 的结构化投影（BLUEPRINT §2）。
 * 仅用于在隔离编译时不依赖宿主模块增强；调用形态与 BLUEPRINT 完全一致。
 */
interface HostSeams {
  fiber?: { entry?: { options?: { id?: unknown } } }
  llm: {
    registerAdapter(providerIds: string[], adapter: unknown): () => void
    registerConfigurableProviders(entries: unknown[]): () => void
    registerModelDiscovery(
      settingsNs: string,
      fn: (request: { provider?: string }, signal?: AbortSignal) => Promise<unknown[]>,
    ): () => void
  }
  inject(services: string[], cb: (sctx: unknown) => void): void
  effect(fn: () => () => void): void
  logger: {
    info(message: string): void
    warn(message: string): void
    error(message: string, error?: unknown): void
  }
  get(name: string): unknown
}

interface SettingsInjected {
  settings?: {
    configure(policy: { auto: boolean }, owner: unknown): () => void
  }
}

/**
 * settings 命名空间探测（BLUEPRINT §2(d)）：`ctx.fiber.entry?.options.id` 是
 * Loader 条目 id，不是插件自选名；探测失败（无 Loader，如测试直接 ctx.plugin()）
 * 时回落到 `PLUGIN_ID`。宿主精确匹配查表，猜错会让 provider 被判「未配置」。
 */
export function settingsNamespaceOf(ctx: unknown): string {
  const id = (ctx as { fiber?: { entry?: { options?: { id?: unknown } } } })?.fiber?.entry?.options?.id
  return typeof id === 'string' && id !== '' ? id : PLUGIN_ID
}

/**
 * 读取一个配置字段的当前值。
 *
 * 标了 `.volatile()` 的字段（设置页可编辑的那些）在运行期是 `Volatile<T>`
 * 包装对象（带 `.get()`），**不是**解包后的值 —— 直接 `config.apiKey` 会拿到
 * 一个对象，`typeof` 判断、`=== true` 比较全部失效。
 *
 * 这里统一解包：有 `.get()` 就调用，否则原样返回。宿主自己也是这么读的
 * （`settings` 服务里用 `plainConfig` 递归 `.get()`）。
 */
function readConfig<T>(value: T | { get(): T }): T {
  if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    return (value as { get(): T }).get()
  }
  return value as T
}

/** 官方 API Key：设置卡优先，环境变量兜底；永不写日志、永不回显。 */
function resolveApiKey(config: ConfigShape): string {
  const fromSettings = readConfig<string | undefined>(config.apiKey as never)
  if (typeof fromSettings === 'string' && fromSettings.length > 0) return fromSettings
  const fromEnv = typeof process !== 'undefined' ? process.env[KEY_ENV_VAR] : undefined
  return typeof fromEnv === 'string' ? fromEnv : ''
}

/**
 * 插件入口。宿主按 `apply(ctx, config)` 同步调用；其中 `await shim.ready` 起的
 * 注册链放在一个异步 IIFE 里（与 BLUEPRINT §2 的 `Promise.all(shims.ready).then`
 * 等价），这样 apply 仍是 `void` 签名，但装配严格按 ①→⑨ 顺序。
 */
export function apply(ctx: Context, config: ConfigShape): void {
  const host = ctx as unknown as HostSeams
  const settingsNs = settingsNamespaceOf(ctx)
  const log = (message: string): void => host.logger.warn(`dsh-connect-catpaw: ${message}`)

  /** 运行时目录（活读）：⑧ 异步刷新后写这里，adapter / modelDiscovery 都读它。 */
  let liveModels: CatalogEntry[] = []
  /** 目录刷新后的失效回调（③ 产物）。 */
  let invalidate: (() => void) | undefined
  /** 所有注册句柄的 dispose 集中在这里，由 ⑨ 的单一 ctx.effect 统一释放。 */
  const disposers: Array<() => void> = []
  let disposed = false

  const release = (): void => {
    if (disposed) return
    disposed = true
    for (const dispose of disposers) {
      try { dispose() } catch { /* 单个句柄释放失败不阻断其余 */ }
    }
    void shim.close()
  }

  // ① createShim：把 config.thinkLongcat 以活读取值器传入，F9 官方侧生效。
  //    apiKey 同样活读（用户改设置后下一次 chat 立刻用新值）。
  const shim = createShim({
    thinkLongcat: () => readConfig<boolean | undefined>(config.thinkLongcat as never) === true,
    apiKey: () => resolveApiKey(config),
  })

  // ⑨ 全部 release 挂 ctx.effect(() => () => release())。
  //    在 apply 期间就注册，保证注册链尚未完成时插件被 dispose 也能正确释放。
  host.effect(() => () => release())

  // ⑦ ctx.inject(['settings'], ...) 配 Config。
  //    schema 由模块级 `export { Config } from './config.ts'` 提供给宿主（§3.2
  //    唯一导出名，含 thinkLongcat / thinkCatpaw / channelB.contextTiers）；
  //    configure 的呈现策略 disposer 挂进 ctx.effect，不泄漏过析构。
  host.inject(['settings'], (sctx) => {
    const settings = (sctx as SettingsInjected).settings
    if (settings === undefined) return
    host.effect(() => settings.configure({ auto: true }, (ctx as unknown as { fiber: unknown }).fiber))
  })

  // 同源路由（webServer 可选注入；缺失时设置卡读镜像即可）。
  host.inject(['webServer'], (ctxWithWeb) => {
    const dispose = registerCatpawWebRoutes(ctxWithWeb, {
      // 官方 tab 数据由路由层就地 listModels() 读取；妙手 tab 走占位 upstream。
      longcat: () => createLongcatClient({ apiKey: resolveApiKey(config) }),
      // /refresh 与 modelDiscovery 共用同一份「活读」目录。
      liveModels: () => officialModels(),
      refreshOfficial: async () => {
        await refreshCatalog()
        return officialModels()
      },
    })
    if (typeof dispose === 'function') disposers.push(dispose)
  })

  /** 官方模型集合（fallback ∪ 运行时 listModels），按 id 去重，仅 longcat 前缀。 */
  function officialModels(): CatalogEntry[] {
    const merged = new Map<string, CatalogEntry>()
    for (const entry of LONGCAT_CATALOG_FALLBACK) merged.set(entry.id, entry)
    for (const entry of liveModels) {
      if (entry.provider !== 'longcat') continue
      merged.set(entry.id, entry)
    }
    return [...merged.values()]
  }

  /** ⑧ 异步 listModels() 刷新目录；失败回落空活读（fallback 仍在）。 */
  async function refreshCatalog(): Promise<void> {
    try {
      const client = createLongcatClient({ apiKey: resolveApiKey(config) })
      liveModels = await client.listModels()
      invalidate?.()
    } catch (error) {
      log(`catalog refresh failed: ${String((error as Error)?.message ?? 'unknown')}`)
      liveModels = []
    }
  }

  // ② await shim.ready → ③..⑥ 注册链。
  void (async () => {
    await shim.ready // ② 端口就绪后才造 adapter
    if (disposed) return

    // 附件服务（可选）：宿主提供时接给 pi-ai，**图片输入才能工作**。
    //
    // 为什么必须有：`dsh-llm-pi-ai` 在消息含图片时要求 config 上有
    // `resolveAttachments`，否则抛
    // `pi-ai image input requires the durable attachment service`。
    // 0.2.1 从未接线，导致通道 A 一遇图片（如 archify 出图）就报错。
    //
    // 为什么用活读：`ctx.inject` 的回调可能晚于 adapter 构造执行，一次性快照
    // 会永远拿到 undefined（与 settings / webServer 同款处理）。
    let attachmentStore: AttachmentStore | undefined
    host.inject(['attachments'], (attachCtx) => {
      const service = (attachCtx as unknown as { attachments?: AttachmentStore }).attachments
      if (service !== undefined) attachmentStore = service
    })

    // 诊断：确认注册链真的跑到了这一步（宿主日志里能看到）。
    host.logger.info(
      `dsh-connect-catpaw: registering provider "${PROVIDER_ROUTE}" `
      + `(settingsNs="${settingsNs}", shim=${shim.baseUrl()}, `
      + `apiKeyPresent=${resolveApiKey(config).length > 0})`,
    )

    // ③ createAdapter（getModels 活读 liveModels，目录刷新立刻生效）。
    const built = createAdapter({
      shim,
      liveModels: () => officialModels(),
      // 活读取值器：图片请求到来时才真正取服务，服务晚到也能拿到。
      resolveAttachments: () => attachmentStore,
    })
    invalidate = built.invalidate

    // ④ ctx.llm.registerAdapter([PROVIDER_ROUTE], adapter)
    const releaseAdapter = host.llm.registerAdapter([PROVIDER_ROUTE], built.adapter)
    disposers.push(releaseAdapter)
    host.logger.info(`dsh-connect-catpaw: adapter registered for "${PROVIDER_ROUTE}"`)

    // ⑤ ctx.llm.registerConfigurableProviders([...])（一次传完整集合，单 provider）。
    //    `settingsNs` 必须是宿主实际服务的命名空间（见 settingsNamespaceOf）。
    const releaseDirectory = host.llm.registerConfigurableProviders([
      {
        provider: PROVIDER_ROUTE,
        displayName: DISPLAY_NAME,
        settingsNs,
        settingsPath: [],
        declared: false,
      },
    ])
    disposers.push(releaseDirectory)

    // ⑥ ctx.llm.registerModelDiscovery(settingsNs, ...) —— 只返回官方前缀模型。
    //    DTO shape 逐字按 BLUEPRINT §2(c)：{ id, name, contextWindow, maxTokens,
    //    inputModalities }[]；不认识的 provider 返回 []。
    const releaseDiscovery = host.llm.registerModelDiscovery(settingsNs, async (request) => {
      if (request.provider !== PROVIDER_ROUTE) return []
      return officialModels().map(model => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        inputModalities: model.input,
      }))
    })
    disposers.push(releaseDiscovery)

    // ⑧ 异步刷新目录（不阻塞注册链；失败由 refreshCatalog 内部兜底）。
    void refreshCatalog()
  })().catch((error: unknown) => {
    host.logger.error('dsh-connect-catpaw: provider registration failed', error)
  })
}
