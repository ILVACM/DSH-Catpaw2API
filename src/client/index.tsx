/**
 * Browser half: the 妙手 / LongCat settings page contributed as a top-level
 * section of the host's Settings panel.
 *
 * 结构参照（不复制源码）：temp/dsh-connect-workbuddy-main/src/client/index.tsx
 *   头部与注册形态 —— 浏览器插件只注入 `slots` / `locale` 两项服务、
 *   `LocaleNamespaceMap` 模块增强、`settings.section` 与 `settings.section.icon`
 *   两个槽位的注册形状、用 `ctx.get()` 软探测 `configForms` 并跟随宿主真正
 *   服务的命名空间重新注册、以及整个 apply 体包 try/catch 以便槽位 API 变更
 *   时降级为 console.error 而不触发宿主 "Failed to load plugins" 红色横幅。
 * 本项目改动：只保留设置页这一处展示位（双 tab 组件替换为本插件的
 *   SettingsCard），section id 与命名空间改为 dsh-connect-catpaw；不注册任何
 *   对话输入区 / 胶囊 / 徽标等其它展示位（展示位置唯一）。
 *
 * 槽位迁移（0.1.1 起）：宿主 0.1.7 线里设置页的槽位是 `settings.section`
 *   （list / root，注册字段 `id` + `order` + `label` + `locale`），导航图标走
 *   独立的 `settings.section.icon`（宿主按 `id` 精确匹配）。阶段一注册的旧
 *   plugin-item 槽位已随宿主删除：`ctx.slots.inject()` 对不存在的槽位只等待、
 *   不报错，所以界面表现是"什么都没出现"，没有任何告警 —— 这正是本次修复的
 *   根因，因此旧槽位名不得以任何形式（含注释）再出现。
 *
 * @module dsh-connect-catpaw/client
 */

import { createElement as h } from 'react'
import type { CSSProperties, JSX } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// `slots` 服务声明由 ui-renderer 这一行提供（type-only 副作用导入）；
// 宿主装载哪一行，就由哪一行提供该增强。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { SettingsCard } from './SettingsCard.tsx'
import type { CatpawSettingsScope, SettingsCardInjected } from './SettingsCard.tsx'
import { en, zh } from './locales.ts'
import type { CatpawSettingsKey } from './locales.ts'
import {
  CATPAW_SETTINGS_NAMESPACE_CANDIDATES,
  CATPAW_SETTINGS_SECTION_ID,
  CATPAW_SETTINGS_SECTION_ORDER,
} from '../status-paths.ts'

/** cordis.patch.yml 的 id / settings 命名空间 / 路由前缀，永不改名。 */
export const PLUGIN_ID = 'dsh-connect-catpaw'

/** Stable browser-plugin name. */
export const name = 'dsh-connect-catpaw-client'

/** 宿主 `configForms.get(ns)` 返回的 scope（DSH 0.1.7 真实形状）。 */
interface HostConfigScope {
  getSnapshot(): { status: string; value?: unknown; writable: boolean }
  set(field: string, value: unknown): Promise<boolean | void>
}

/** 宿主 `configForms` 服务（只声明本文件用到的成员）。 */
interface HostConfigForms {
  describe(): { getSnapshot(): { view?: { namespaces?: { ns: string }[] } } }
  get(ns: string): HostConfigScope
  whileServed(
    namespaces: readonly string[],
    register: (served: ReadonlySet<string>) => () => void,
  ): () => void
}

/**
 * 本入口需要的浏览器侧服务：slots（设置页槽位）、locale（文案注册）与
 * configForms（配置读写，由 `@deepseek-ai/dsh-client-ui-settings` 提供）。
 * Cordis' `Context` 已携带 `effect` fiber API。
 */
export type CatpawClientContext = Context & {
  slots: Context['slots']
  locale: Context['locale']
  configForms: HostConfigForms
}

/**
 * Cordis 依赖门。
 *
 * **`configForms` 必须在这里声明。** 它是 `@deepseek-ai/dsh-client-ui-settings`
 * 提供的一个**真实服务**（`super(ctx, 'configForms')`），宿主内置的每一个
 * client 插件都把它写进自己的 `inject`（实测 app.asar 里 19 处）。
 *
 * 之前只写了 `['slots','locale']`、改用 `ctx.get('configForms')` 软探测 ——
 * 结果拿到的是 `undefined`，卡片一路走到"降级只读"分支，永远显示
 * 「无法读取插件配置」。软探测**不能**用来访问一个需要声明才能拿到的服务：
 * 它只会安静地返回 undefined，而不是告诉你"你忘了声明"。
 *
 * 保留 `ctx.get()` 读法作为纵深防御：万一某个宿主行真的不提供该服务，
 * 卡片仍会显示（只是只读），而不是整页消失。
 */
export const inject = ['slots', 'locale', 'configForms']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 妙手 / LongCat 设置页文案。 */
    'settings.catpaw': CatpawSettingsKey
  }
}

/**
 * 导航行图标：纯内联 CSS 方块。
 *
 * 刻意不引任何图标包 —— `dsh-client-ui-primitives` 的图标族名在宿主版本间
 * 改过，把图标绑定到它的导出上等于把"设置页能不能显示"押在一个会变的名字上。
 * 一个 `currentColor` 方块不依赖任何外部资源，且自动跟随主题前景色。
 *
 * 宿主渲染该槽位时传 `{ size, active }`（按 section 的 `id` 精确匹配）。
 */
function CatpawSectionIcon(props: { size?: number; active?: boolean } | undefined): JSX.Element {
  const edge = typeof props?.size === 'number' ? props.size : 16
  const style: CSSProperties = {
    display: 'inline-block',
    width: edge,
    height: edge,
    borderRadius: 4,
    background: 'currentColor',
    opacity: props?.active === true ? 1 : 0.65,
  }
  return h('span', { 'aria-hidden': 'true', style })
}

/**
 * 注册设置页文案，把 SettingsCard 挂到 `settings.section`，并把导航图标挂到
 * `settings.section.icon`；同时把配置读写接到宿主的 `configForms` 服务。
 *
 * 整段包 try/catch：槽位 API 变更 / 宿主缺失服务时降级为 console.error，
 * 不抛异常（否则宿主弹 "Failed to load plugins" 红色横幅），宿主侧 provider
 * 仍正常服务模型。
 */
export function apply(ctx: CatpawClientContext): void {
  try {
    const namespace = 'settings.catpaw'
    // 注册 zh / en 两套字典；dictionary shape 由 LocaleNamespaceMap 增强约束。
    ctx.effect(
      () => ctx.locale.register(namespace, { zh, en }),
      'dsh-connect-catpaw: settings copy',
    )
    const t = ctx.locale.bind(namespace) as SettingsCardInjected['t']

    /**
     * 软探测宿主服务。
     *
     * 属性访问会抛：`ctx.configForms` 在未 inject 时抛 "cannot get property X
     * without inject"，`?.` 挡不住（它不是 null，是抛异常的 getter）。
     * `ctx.get(name)` 在服务不存在时返回 `undefined` —— 这是唯一安全的读法。
     */
    const softGet = (name: string): unknown =>
      (ctx as unknown as { get(name: string): unknown }).get(name)

    /** 当前绑定的配置 scope；宿主未提供 configForms 时保持 undefined（卡片降级只读）。 */
    let settingsScope: CatpawSettingsScope | undefined
    /** 当前这套注册的 disposers；换绑时先全部 dispose 再整体替换。 */
    let liveDisposers: Array<() => void> = []

    /**
     * `configForms` 是 0.1.7 线的客户端设置服务（旧 `settingsScope` 服务已随
     * 0.1.5 线删除，因此没有可回落的第二来源）。
     *
     * `describe()` 按 Loader entry id 给表单命名，而 entry id 由 profile patch
     * 决定，所以命名空间必须**问**宿主，不能假设；候选拼写见
     * `CATPAW_SETTINGS_NAMESPACE_CANDIDATES`。
     */
    /**
     * 宿主 `configForms.get(ns)` 返回的 scope —— **宿主真实形状**是
     * `getSnapshot()` / `set()`，不是卡片用的 `read()` / `write()`。
     *
     * 这里必须按宿主形状声明（而不是直接标成 `CatpawSettingsScope`）：否则
     * TypeScript 会"通过"，但运行期卡片调 `settingsScope.read(...)` 会抛
     * `TypeError: ... is not a function` —— 类型骗过编译器、运行时才炸。
     */
    const adaptScope = (scope: HostConfigScope): CatpawSettingsScope => ({
      read(key: string): unknown {
        const value = scope.getSnapshot().value
        if (typeof value !== 'object' || value === null) return undefined
        return (value as Record<string, unknown>)[key]
      },
      write(key: string, value: unknown): void | Promise<void> {
        // 宿主 `set()` 解析为 `boolean | void`（是否写入成功）；卡片的契约只要
        // "已完成"，丢弃布尔结果，避免调用点被迫处理一个它们不关心的值。
        return Promise.resolve(scope.set(key, value)).then(() => undefined)
      },
    })

    /**
     * `configForms` 现在是**已注入的服务**（见模块级 `inject`），所以直接取
     * `ctx.configForms` 即可；`ctx.get()` 只作为"某宿主行没提供它"时的兜底
     * （那时卡片显示只读，而不是整页消失）。
     */
    const forms: HostConfigForms | undefined =
      (ctx as unknown as { configForms?: HostConfigForms }).configForms
      ?? (softGet('configForms') as HostConfigForms | undefined)

    /**
     * 注册设置页与它的导航图标，返回全部 disposers。
     *
     * section 与 icon 各自独立 try/catch：页面是功能本体，图标是装饰 ——
     * 声明了 section 却没有声明图标槽位的宿主，仍必须拿到页面。
     */
    const registerAllSlots = (): Array<() => void> => {
      const disposers: Array<() => void> = []

      // —— settings.section：设置导航里的一页 ——
      try {
        const disposer = ctx.slots.inject('settings.section' as never, () => {
          const registry = ctx.slots as unknown as {
            register(
              options: {
                name: string
                id: string
                order: number
                label: () => string
                locale: string
                inject: () => SettingsCardInjected
              },
              component: unknown,
            ): () => void
          }
          return registry.register({
            name: 'settings.section',
            id: CATPAW_SETTINGS_SECTION_ID,
            order: CATPAW_SETTINGS_SECTION_ORDER,
            // label 是 thunk：宿主每读一次都跟随当前 locale，切换语言无需重注册。
            label: () => t('nav.label'),
            locale: namespace,
            inject: () => {
              // 宿主给这一页的 props 只有 `close`；其余字段是我们给自家组件的。
              const props: SettingsCardInjected = { t }
              if (settingsScope !== undefined) props.settingsScope = settingsScope
              return props
            },
          }, SettingsCard)
        })
        if (typeof disposer === 'function') disposers.push(disposer)
      } catch (error: unknown) {
        console.error('[dsh-connect-catpaw] settings.section failed to register:', error)
      }

      // —— settings.section.icon：按同一个 id 精确匹配的导航图标 ——
      try {
        const disposer = ctx.slots.inject('settings.section.icon' as never, () => {
          const registry = ctx.slots as unknown as {
            register(
              options: { name: string; id: string; locale: string },
              component: unknown,
            ): () => void
          }
          return registry.register({
            name: 'settings.section.icon',
            // 必须与 section 的 id 完全相同：宿主按 row.id 精确匹配，不同则静默回落默认齿轮。
            id: CATPAW_SETTINGS_SECTION_ID,
            locale: namespace,
          }, CatpawSectionIcon)
        })
        if (typeof disposer === 'function') disposers.push(disposer)
      } catch (error: unknown) {
        // 图标失败不得带走页面。
        console.error('[dsh-connect-catpaw] settings.section.icon failed (page still renders):', error)
      }

      return disposers
    }

    /**
     * 把 `settingsScope` 绑到宿主**真正服务**的命名空间，并在答案变化时
     * 重新注册全部槽位。
     *
     * 为什么不能只在启动时读一次：镜像由异步 `remote.settings.describe()`
     * 填充，`apply` 执行时 `view` 通常还是 undefined。凭"读不到"就认定自己
     * 猜的命名空间正确，会让表单永远停在 unavailable 状态。
     *
     * `whileServed` 是宿主自己的写法：只在 unserved→served 的**边沿**触发，
     * 并交出宿主实际服务的命名空间集合；宿主停止服务时还会撤销绑定。
     *
     * 边沿触发时必须**先 dispose 旧注册、再重新注册**：渲染器按 entry 身份
     * 缓存 `inject()` 结果（`if (!props) props = runInject(...)`），陈旧注册会
     * 一直服务陈旧 props，追加注册则会撞上"同 id 同优先级"的重复注册。
     */
    const bindSettingsScope = (): void => {
      if (forms === undefined || typeof forms.whileServed !== 'function') {
        // 宿主没有 configForms（或早于 whileServed 的版本）：按声明名绑一次，
        // 卡片降级为只读，这是文档化的降级路径。
        const fallback = forms?.get(CATPAW_SETTINGS_SECTION_ID)
        settingsScope = fallback === undefined ? undefined : adaptScope(fallback)
        liveDisposers = registerAllSlots()
        return
      }

      // 包在 ctx.effect 里：whileServed 本身不在我们的 context 上注册任何东西，
      // 监听的生命周期归本插件 fiber。
      ctx.effect(() => forms.whileServed(
        CATPAW_SETTINGS_NAMESPACE_CANDIDATES,
        (served) => {
          const ns = CATPAW_SETTINGS_NAMESPACE_CANDIDATES.find(candidate => served.has(candidate))
          settingsScope = ns === undefined ? undefined : adaptScope(forms.get(ns))
          // 替换而非追加（原因见上）。
          for (const dispose of liveDisposers) {
            try { dispose() } catch { /* 已被槽位服务 dispose */ }
          }
          liveDisposers = registerAllSlots()
          return () => {
            for (const dispose of liveDisposers) {
              try { dispose() } catch { /* 同上 */ }
            }
            liveDisposers = []
          }
        },
      ), 'dsh-connect-catpaw: settings namespace binding')

      // 不等待边沿：首次注册照常进行。
      //
      // 边沿只在"首次答案已含本命名空间"时于 whileServed 内部同步触发，那时
      // 上面的回调已经注册过一次 —— 这里再注册会撞重复，所以必须先 dispose
      // 已有注册再整体替换（即 registerAllSlots 前清空）。而当首次答案不含本
      // 命名空间（候选拼写未覆盖、设置面晚到或失败、部署形态没有可配置 entry）
      // 时永远不会来边沿，只等边沿就等于"永远不注册"—— 卡片在无表单时仍可用
      // （数据来自宿主 status 路由，只读），所以注册不能以命名空间为条件。
      for (const dispose of liveDisposers) {
        try { dispose() } catch { /* 已被槽位服务 dispose */ }
      }
      liveDisposers = registerAllSlots()
    }

    bindSettingsScope()
    // 展示位置唯一：此处不注册任何对话输入区 / 胶囊 / 徽标等其它槽位。
  } catch (error: unknown) {
    // 页面静默降级：宿主 provider 仍服务模型；开发者在浏览器控制台看完整原因。
    console.error('[dsh-connect-catpaw] client card failed to load (host provider unaffected):', error)
  }
}
