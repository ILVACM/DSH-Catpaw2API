// src/config.ts —— 逐字形态，字段名/默认值/API 固定（已按 temp/ 确证）
import z from '@deepseek-ai/schemastery'
import type { CatalogEntry } from './contracts.ts'
import { KEY_ENV_VAR } from './routing.ts'

/**
 * 宿主侧看到的配置值（**已解包**的普通值）。
 *
 * `.volatile()` 会让 schema 的输出类型变成 `Volatile<T>`（一个带 `.get()`
 * 的活值包装）。但 `apply(ctx, config)` 拿到的 config 里，schemastery 已经
 * 把 volatile 包装解析成当前值（见 cosmokit `plainConfig`：遇到 volatile
 * 就 `.get()`），所以**宿主侧读到的就是普通值**。
 *
 * 因此这里保持普通类型，宿主侧代码零改动；schema 侧用下面的 `ConfigSchema`
 * 承载 volatile 标记。
 */
export interface Config {
  apiKey: string
  apiKeyEnv: string
  lastCatalog: CatalogEntry[]
  // 决策 3 / F9：两个「深度思考」二值开关；false=关 / true=开；各自独立、互不联动
  thinkLongcat: boolean
  thinkCatpaw: boolean
  channelB: {
    enabled: boolean
    catalog: CatalogEntry[]
    credits: number | null
    // 决策 4b / F10：逐模型上下文档位值，key = 带前缀的模型 id，value = 档位字面量
    contextTiers: Record<string, '200K' | '500K' | '1M'>
  }
}

// 依据：temp/dsh-connect-qoder-main/src/index.ts:206 用 z.any<T>() 承载复合对象；
//       temp/dsh-connect-workbuddy-main/src/index.ts:1200 用 z.union([...]).default(...)。
// 故这里不臆造 CatalogEntry 的嵌套 schema、不用 .nullable()、不用 as unknown as。
const catalogEntry = z.any<CatalogEntry>()
const nullableNumber = z.union([z.number(), z.const(null)])
const contextTier = z.union([z.const('200K'), z.const('500K'), z.const('1M')])

/**
 * 插件配置 schema。
 *
 * ## 为什么每个可编辑字段都要 `.volatile()`
 *
 * 宿主的设置系统只把「标了 volatile 的字段」投影成设置页表单
 * （`packages/settings/settings/src/schema.ts` 的 `volatileForm()`）：
 * 一个 volatile 字段都没有的插件，会被 `describe()` **直接跳过**，
 * 它的命名空间根本不会出现在 Host 服务的列表里 —— 客户端于是永远拿不到
 * 配置，设置卡只能降级为只读。
 *
 * 这正是 0.1.0~0.1.2 设置卡一直显示「无法读取插件配置」的根因：
 * 早期版本一个 `.volatile()` 都没有，宿主当作本插件不存在。
 *
 * 参照宿主官方写法（`packages/client/ui-chat/src/index.ts`）：
 * `z.object({ transcriptView: ...volatile(), ... })`。
 *
 * ## 嵌套对象只在外层标一次
 *
 * schemastery 禁止 volatile 套 volatile（`validateVolatileSchema` 会抛
 * "volatile fields require a fixed object path without an enclosing volatile
 * field"）。`channelB` 整体标 volatile 后，其子字段**不得**再标。
 *
 * 另外 `ConfigFormController.set(field, value)` 的 `field` 只接受**顶层**
 * 字段名（内部固定 `path: [field]`），所以 `channelB` 只能整对象读写。
 */
export const Config = z.object({
  apiKey: z.string().default('').description('LongCat API Key (stored locally only)').volatile(),
  // 内部字段：不进设置页（不加 volatile），否则会被表单投影成可编辑项。
  apiKeyEnv: z.string().default(KEY_ENV_VAR).description('Env var NAME only, never the value'),
  // 运行时缓存：不进设置页。它是 CatalogEntry[]（z.any），表单往返会把结构写坏。
  lastCatalog: z.array(catalogEntry).default([]),
  thinkLongcat: z.boolean().default(true).volatile(),        // 官方默认开思考（跟随上游默认）
  thinkCatpaw: z.boolean().default(true).volatile(),         // 妙手默认跟随客户端（见 §3.9）
  channelB: z.object({
    enabled: z.boolean().default(false),                    // 阶段一恒 false
    catalog: z.array(catalogEntry).default([]),             // 占位假清单（内部缓存，不进表单）
    credits: nullableNumber.default(null),                  // 占位：null = 未实现
    contextTiers: z.dict(contextTier).default({}),           // 逐模型档位值，阶段一存占位选择
  }).default({ enabled: false, catalog: [], credits: null, contextTiers: {} }).volatile(),
}) as unknown as z<Config>
