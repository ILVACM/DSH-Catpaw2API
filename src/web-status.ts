/**
 * Host 端同源路由：/status、/tabs、/refresh。
 *
 * 形态以 qoder `src/web-status.ts` 为**结构参照**独立重写（未复制其源码）：
 * `ctx.webServer.register({ kind: 'exact', path, handler })`；返回 `TabView[]`。
 *
 * 决策 1（硬）：官方 tab `credits` **恒 null**、不读任何余额/用量接口；
 * 本文件不得出现任何余额读取标识符。官方 tab 的模型列表与实时参数来自
 * `longcat.listModels()`（决策 2）。
 * 妙手 tab 走 `createChannelBUpstream().probe()`（阶段二：只回模型名 + 可用状态）。
 *
 * 路由常量**只从 `status-paths.ts` 取**；本文件不另定义路径字面量。
 * 用户可见文案一律「妙手」；技术标识原样保留。
 *
 * @module dsh-connect-catpaw/web-status
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CatalogEntry, TabView } from './status-paths.ts'
import { STATUS_PATH, TABS_PATH, REFRESH_PATH } from './status-paths.ts'
import { createChannelBUpstream } from './channel-b.ts'
import { CATPAW_CATALOG, CATPAW_MODEL_NAME } from './routing.ts'

/** 官方客户端最小契约（由 index.ts 注入；只读，不含任何余额读取）。 */
export interface CatpawLongcatSource {
  listModels(): Promise<CatalogEntry[]>
}

export interface CatpawWebRouteDeps {
  /** 官方客户端工厂（Key 由 index.ts 解析后注入）。 */
  longcat: () => CatpawLongcatSource
  /** 运行时活读目录（供 /status 与 /tabs 聚合；可为空）。 */
  liveModels: () => CatalogEntry[]
  /** /refresh 对官方重新跑 listModels() 的回调（index.ts 提供）。 */
  refreshOfficial: () => Promise<CatalogEntry[]>
}

/**
 * `modelDetailSource` 聚合规则（决策 2）：
 * - 全部 `detailSource === 'live'` → 'live'
 * - 全部 `detailSource === 'fallback'` → 'fallback'
 * - 混合 / 部分失败 → 'partial'
 * - 空目录 → 'fallback'（保守：无实时证据）
 */
function aggregateDetailSource(models: readonly CatalogEntry[]): 'live' | 'fallback' | 'partial' {
  if (models.length === 0) return 'fallback'
  let live = 0
  let fallback = 0
  for (const model of models) {
    if (model.detailSource === 'live') live += 1
    else fallback += 1
  }
  if (live === models.length) return 'live'
  if (fallback === models.length) return 'fallback'
  return 'partial'
}

/** 官方 tab：credits 恒 null（决策 1）、models 来自 listModels()、placeholder:false。 */
async function buildOfficialTab(deps: CatpawWebRouteDeps): Promise<TabView> {
  let models: CatalogEntry[] = []
  try {
    models = await deps.longcat().listModels()
  } catch {
    // 接口失败回落活读目录（fallback 由 longcat.listModels 内部逐条标注）。
    models = deps.liveModels().filter(model => model.provider === 'longcat')
  }
  return {
    channel: 'longcat',
    // 决策 1：官方 tab 恒 null，不读任何余额/用量接口。
    credits: null,
    models,
    modelDetailSource: aggregateDetailSource(models),
    placeholder: false,
  }
}

/** B tab：模型名 + 可用状态（plan.md §2.3）。 */
async function buildCatpawTab(): Promise<TabView> {
  const upstream = createChannelBUpstream()
  let probe = { available: false, modelName: CATPAW_MODEL_NAME, reason: '未检测' }
  try {
    probe = await upstream.probe()
  } catch (error) {
    probe = {
      available: false,
      modelName: CATPAW_MODEL_NAME,
      reason: String((error as Error)?.message ?? '检测失败'),
    }
  }
  return {
    channel: 'catpaw',
    credits: null,                    // 目标不含额度
    models: probe.available ? CATPAW_CATALOG : [],
    placeholder: false,
    probe,
  }
}

/** GET 三路由共用的 TabView[] 文档。 */
async function buildTabs(deps: CatpawWebRouteDeps): Promise<TabView[]> {
  const [official, catpaw] = await Promise.all([buildOfficialTab(deps), buildCatpawTab()])
  return [official, catpaw]
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * 挂载 /status、/tabs、/refresh 三条同源精确路由。
 * 返回统一 disposer；index.ts 把它挂进 ⑨ 的集中释放。
 */
export function registerCatpawWebRoutes(ctx: unknown, deps: CatpawWebRouteDeps): () => void {
  const web = (ctx as {
    webServer: {
      register(route: { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }): () => void
    }
  }).webServer
  const disposers: Array<() => void> = []

  const mount = (
    path: string,
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  ): void => {
    try {
      const dispose = web.register({ kind: 'exact', path, handler })
      if (typeof dispose === 'function') disposers.push(dispose)
    } catch {
      // 路由已注册（重复 inject）时忽略，析构时统一释放。
    }
  }

  // GET /status —— 与 /tabs 同一份 TabView[] 文档。
  mount(STATUS_PATH, async (req, res) => {
    if (req.method !== 'GET') return writeJson(res, 405, { error: 'method not allowed' })
    return writeJson(res, 200, await buildTabs(deps))
  })

  // GET /tabs —— 设置卡双 tab 数据（官方 + 妙手）。
  mount(TABS_PATH, async (req, res) => {
    if (req.method !== 'GET') return writeJson(res, 405, { error: 'method not allowed' })
    return writeJson(res, 200, await buildTabs(deps))
  })

  // POST /refresh —— 对官方重新跑 listModels()；对妙手返回占位。
  mount(REFRESH_PATH, async (req, res) => {
    if (req.method !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
    try {
      await deps.refreshOfficial()
    } catch {
      // 刷新失败不冒充成功：官方 tab 仍由下一次 listModels 决定 fallback 标注。
    }
    const [official, catpaw] = await Promise.all([buildOfficialTab(deps), buildCatpawTab()])
    return writeJson(res, 200, [official, catpaw])
  })

  return () => {
    for (const dispose of disposers) {
      try { dispose() } catch { /* 单个释放失败不阻断其余 */ }
    }
  }
}
