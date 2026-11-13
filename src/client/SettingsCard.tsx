/**
 * 妙手 / LongCat 设置卡 —— 一张卡、两个独立 tab（§3.6 / §7-T5）。
 *
 * 结构参照（不复制源码）：temp/dsh-connect-workbuddy-main/src/client/WorkBuddyCard.tsx
 *   头部 —— 卡片外壳 / tab 栏 / 草稿态与保存流程的形态。
 * 本项目改动：
 *   1. 两个 tab 按通道分数据（longcat / catpaw），互不混显；
 *   2. 官方 tab 决策 1 后无余额 / 用量栏、决策 4b 后无档位选择器；
 *   官方 tab 每个模型只渲染两行：带前缀的模型名 + 「上下文/输入/输出」三个 x.xxM 数字
 *   （见 P1-code.md §3.4）；
 *   3. 阶段二：妙手 tab 改为「本地客户端通道复用」，只显示
 *   「当前模型」+「状态」两行 + 人工刷新按钮 + 风险提示（plan.md §2.3）；
 *   4. 官方 tab 的「深度思考」二值开关保留；妙手 tab 不再有开关 / 档位 / 额度；
 *   5. 所有读数 / 开关只在卡内，不 portal 到对话框输入区、
 *      不注册任何对话输入框 / 胶囊 / 徽标槽位。
 *
 * 用户可见文案一律「妙手」（§3.8）；技术标识（catpaw/ 等）原样保留。
 *
 * @module dsh-connect-catpaw/client/SettingsCard
 */

import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { CatalogEntry, TabView } from '../contracts.ts'
import { LONGCAT_CATALOG_FALLBACK } from '../routing.ts'
import { REFRESH_PATH, TABS_PATH } from '../status-paths.ts'
import type { CatpawSettingsKey } from './locales.ts'
import { formatTokens } from './format.ts'
import './styles.ts'   // 副作用导入：styles.ts 在模块顶层自注入 CSS

type T = (key: CatpawSettingsKey) => string

/**
 * 宿主注入的可选设置读写面（configForms 服务提供的 scope；缺失时只保留卡内草稿态）。
 * 保留 read / write 两个方法：卡片内部所有读配置 / 写配置的调用点都依赖这对方法。
 */
export interface CatpawSettingsScope {
  read(key: string): unknown
  write(key: string, value: unknown): void | Promise<void>
}

/** configForms scope 注入给卡片的业务面（DSH 0.1.7+）。 */
export interface SettingsCardInjected {
  t: T
  /** 宿主设置外壳传入的关闭回调；可缺省（缺省时不渲染关闭按钮）。 */
  close?: () => void
  /** 配置读写 scope；宿主未提供 configForms 时为 undefined（卡片降级为只读）。 */
  settingsScope?: CatpawSettingsScope
}

interface TabDef {
  id: 'longcat' | 'catpaw'
  labelKey: CatpawSettingsKey
  showModelParams: boolean
  showThinkSwitch: boolean
}

// §3.6：字段名 / 取值固定。两个 tab 的形态由这两个 show* 开关分流。
const TAB_LONGCAT: TabDef = {
  id: 'longcat', labelKey: 'tab.longcat',
  showModelParams: true, showThinkSwitch: true,
}
const TAB_CATPAW: TabDef = {
  id: 'catpaw', labelKey: 'tab.catpaw',
  showModelParams: false, showThinkSwitch: false,
}
const TABS: readonly TabDef[] = [TAB_LONGCAT, TAB_CATPAW]

/** B 通道状态（plan.md §2.3 三态）。 */
export interface ChannelBStatus {
  state: 'checking' | 'available' | 'unavailable'
  modelName: string
  reason: string
}

const STATUS_CHECKING: ChannelBStatus = { state: 'checking', modelName: '', reason: '' }

function fallbackView(channel: 'longcat' | 'catpaw'): TabView {
  return channel === 'longcat'
    ? {
        channel: 'longcat',
        credits: null,                       // 决策 1：官方 tab 恒 null
        models: LONGCAT_CATALOG_FALLBACK,
        modelDetailSource: 'fallback',
        placeholder: false,
      }
    : {
        channel: 'catpaw',
        credits: null,                       // 阶段二：目标不含额度
        models: [],
        placeholder: false,
        probe: { available: false, modelName: '', reason: '未检测' },
      }
}

function initialTabViews(): TabView[] {
  return [fallbackView('longcat'), fallbackView('catpaw')]
}

function asTabView(value: unknown): TabView | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Partial<TabView>
  if (v.channel !== 'longcat' && v.channel !== 'catpaw') return null
  if (!Array.isArray(v.models)) return null
  const view: TabView = {
    channel: v.channel,
    credits: v.credits ?? null,
    models: v.models as CatalogEntry[],
    placeholder: v.placeholder === true,
  }
  if (v.modelDetailSource !== undefined) view.modelDetailSource = v.modelDetailSource
  if (v.probe !== undefined) view.probe = v.probe
  return view
}

/** /tabs 返回 TabView[]；/refresh 阶段一可能返回单个占位 TabView，两者都接受。 */
function asTabViews(value: unknown): TabView[] | null {
  const list = Array.isArray(value) ? value : [value]
  const out: TabView[] = []
  for (const item of list) {
    const view = asTabView(item)
    if (view !== null) out.push(view)
  }
  return out.length > 0 ? out : null
}

function mergeViews(prev: readonly TabView[], incoming: readonly TabView[]): TabView[] {
  const next: TabView[] = [...prev]
  for (const view of incoming) {
    const index = next.findIndex(v => v.channel === view.channel)
    if (index >= 0) next[index] = view
    else next.push(view)
  }
  return next
}

function viewOf(views: readonly TabView[], channel: 'longcat' | 'catpaw'): TabView {
  return views.find(v => v.channel === channel) ?? fallbackView(channel)
}

/** 从 B tab 的 probe 字段派生三态状态（不编造"可用"）。 */
function statusOf(views: readonly TabView[]): ChannelBStatus {
  const probe = viewOf(views, 'catpaw').probe
  if (probe === undefined) {
    return { state: 'unavailable', modelName: '', reason: '宿主未返回检测结果' }
  }
  return {
    state: probe.available ? 'available' : 'unavailable',
    modelName: probe.modelName,
    reason: probe.reason,
  }
}

function readBool(settingsScope: CatpawSettingsScope | undefined, key: string, fallback: boolean): boolean {
  const value = settingsScope?.read(key)
  return typeof value === 'boolean' ? value : fallback
}

function readString(settingsScope: CatpawSettingsScope | undefined, key: string, fallback: string): string {
  const value = settingsScope?.read(key)
  return typeof value === 'string' ? value : fallback
}

/** detailSource==='fallback' 或 modelDetailSource!=='live' 时标注「回落/兜底」。 */
function isFallback(model: CatalogEntry, view: TabView): boolean {
  return model.detailSource === 'fallback' || view.modelDetailSource !== 'live'
}

/** 决策 3：二值开关（开 / 关，无多档）。仅官方 tab 使用。 */
function ThinkSwitch({ t, value, onToggle }: {
  t: T
  value: boolean
  onToggle: (next: boolean) => void
}): JSX.Element {
  return (
    <label className="catpaw-think">
      <span>{t('think.switch')}</span>
      <button type="button" aria-pressed={value} onClick={() => onToggle(!value)}>
        {value ? t('think.on') : t('think.off')}
      </button>
    </label>
  )
}

/**
 * 官方 tab（showModelParams:true）。
 * 只显示模型列表 + 实时参数 + Key 入口 + 一个深度思考二值开关。
 * 决策 1：本分支不渲染任何余额 / 用量读数栏、也不放任何占位提示、
 * 不显示任何档位选择器；不要求刷新按钮。
 */
function OfficialTabBody({ t, view, showModelParams, showThinkSwitch, thinkValue, onThink, apiKey, onApiKey, onSaveKey }: {
  t: T
  view: TabView
  showModelParams: boolean
  showThinkSwitch: boolean
  thinkValue: boolean
  onThink: (next: boolean) => void
  apiKey: string
  onApiKey: (next: string) => void
  onSaveKey: () => void
}): JSX.Element {
  return (
    <div className="catpaw-tab-body catpaw-tab-longcat">
      {/* API 密钥置顶：先填 Key 再看模型，符合"先配好再挑模型"的使用顺序。 */}
      <div className="catpaw-key-row">
        {/* Key 值只存本机；输入框不回显已保存的值。 */}
        <input
          type="password"
          value={apiKey}
          placeholder={t('key.input')}
          onChange={e => onApiKey(e.currentTarget.value)}
        />
        <button type="button" onClick={onSaveKey}>{t('save')}</button>
      </div>
      {showModelParams ? (
        <ul className="catpaw-model-list">
          {view.models.map(model => (
            <li key={model.id}>
              <div className="catpaw-model-name">
                {model.name}
                {isFallback(model, view)
                  ? <span className="catpaw-fallback"> · {t('model.fallback.short')}</span>
                  : null}
              </div>
              <div className="catpaw-model-meta">
                {t('model.context')} {formatTokens(model.contextWindow)}
                {' · '}
                {t('model.input')} {formatTokens(model.contextWindow)}
                {' · '}
                {t('model.output')} {formatTokens(model.maxTokens)}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {showThinkSwitch ? <ThinkSwitch t={t} value={thinkValue} onToggle={onThink} /> : null}
    </div>
  )
}

/**
 * 妙手 tab（阶段二「本地客户端通道复用」）。
 * 只有两行：「当前模型」+「状态」，外加人工刷新按钮与风险提示。
 * 不显示额度 / 档位 / 思考开关 / 登录入口 / 占位文案（plan.md §2.2）。
 */
function CatpawTabBody({ t, status, refreshing, onRefresh }: {
  t: T
  status: ChannelBStatus
  refreshing: boolean
  onRefresh: () => void
}): JSX.Element {
  return (
    <div className="catpaw-tab-body catpaw-tab-catpaw">
      <div className="catpaw-channelb-row">
        <span className="catpaw-channelb-label">{t('channelb.model')}</span>
        <span className="catpaw-channelb-value">{status.modelName || '—'}</span>
      </div>
      <div className="catpaw-channelb-row">
        <span className="catpaw-channelb-label">{t('channelb.status')}</span>
        <span className="catpaw-channelb-value">
          {status.state === 'checking'
            ? t('channelb.checking')
            : status.state === 'available'
              ? `✅ ${t('channelb.available')}`
              : `❌ ${t('channelb.unavailable')}${status.reason ? ` — ${status.reason}` : ''}`}
        </span>
      </div>
      <div className="catpaw-actions">
        <button type="button" onClick={onRefresh} disabled={refreshing}>{t('channelb.refresh')}</button>
      </div>
      <div className="catpaw-channelb-risk">{t('channelb.risk')}</div>
    </div>
  )
}

/**
 * 一张卡、两个独立 tab。数据按 channel 取，互不混显；所有读数 / 开关
 * 只在卡内渲染，不 portal 到对话框输入区。
 *
 * props 契约（DSH 0.1.7+）：宿主外壳已有自己的关闭 chrome，本卡不渲染关闭按钮，
 * 因此不解构 `close`；`settingsScope` 缺省时降级为只读并显示提示条。
 */
export function SettingsCard({ t, settingsScope }: SettingsCardInjected): JSX.Element {
  const [active, setActive] = useState<'longcat' | 'catpaw'>('longcat')
  const [tabViews, setTabViews] = useState<readonly TabView[]>(initialTabViews)
  const [refreshing, setRefreshing] = useState(false)
  // B 通道状态：打开设置页自动检测一次（plan.md §2.3）。
  const [channelB, setChannelB] = useState<ChannelBStatus>(STATUS_CHECKING)
  // 官方侧开关：独立绑定，不与 B 联动（§3.9 默认值 true）。
  const [thinkLongcat, setThinkLongcat] = useState<boolean>(() => readBool(settingsScope, 'thinkLongcat', true))
  const [apiKeyDraft, setApiKeyDraft] = useState<string>(() => readString(settingsScope, 'apiKey', ''))

  // 打开设置页自动检测一次：拉 /tabs，用 catpaw 段的 probe 填状态。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(TABS_PATH, { headers: { accept: 'application/json' } })
        if (!response.ok) {
          if (!cancelled) setChannelB({ state: 'unavailable', modelName: '', reason: `状态接口返回 ${response.status}` })
          return
        }
        const views = asTabViews(await response.json() as unknown)
        if (cancelled || views === null) return
        setTabViews(prev => mergeViews(prev, views))
        setChannelB(statusOf(views))
      } catch (error) {
        // 失败可见：不静默停在"检测中…"，显式标注不可用与原因。
        if (!cancelled) {
          setChannelB({
            state: 'unavailable',
            modelName: '',
            reason: String((error as Error)?.message ?? '检测失败'),
          })
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  /** 人工刷新：重新检测 B 通道状态。 */
  const onRefresh = useCallback(() => {
    setRefreshing(true)
    setChannelB(prev => ({ ...prev, state: 'checking' }))
    void (async () => {
      try {
        const response = await fetch(REFRESH_PATH, { method: 'POST', headers: { accept: 'application/json' } })
        if (!response.ok) {
          setChannelB({ state: 'unavailable', modelName: '', reason: `状态接口返回 ${response.status}` })
          return
        }
        const views = asTabViews(await response.json() as unknown)
        if (views === null) {
          setChannelB({ state: 'unavailable', modelName: '', reason: '状态接口返回为空' })
          return
        }
        setTabViews(prev => mergeViews(prev, views))
        setChannelB(statusOf(views))
      } catch (error) {
        setChannelB({
          state: 'unavailable',
          modelName: '',
          reason: String((error as Error)?.message ?? '检测失败'),
        })
      } finally {
        setRefreshing(false)
      }
    })()
  }, [])

  const onThinkLongcat = (next: boolean): void => {
    setThinkLongcat(next)
    void settingsScope?.write('thinkLongcat', next)      // 绑 Config.thinkLongcat
  }
  const onSaveKey = (): void => {
    void settingsScope?.write('apiKey', apiKeyDraft)     // 绑 Config.apiKey（值只存本机）
  }

  const tab = active === 'longcat' ? TAB_LONGCAT : TAB_CATPAW
  const view = viewOf(tabViews, tab.id)

  return (
    <section className="catpaw-card">
      {/* 降级提示：宿主未提供 configForms 时不得静默失效，显式告知只读。 */}
      {settingsScope === undefined ? (
        <div
          role="status"
          style={{
            margin: '0 0 8px',
            padding: '6px 10px',
            borderRadius: 4,
            fontSize: 12,
            lineHeight: 1.5,
            color: '#8a4b00',
            background: '#fff4e5',
            border: '1px solid #f0c88a',
          }}
        >
          {t('scope.unavailable')}
        </div>
      ) : null}
      <header className="catpaw-card-header">
        <h2>{t('card.title')}</h2>
        <nav className="catpaw-tabs" role="tablist">
          {TABS.map(item => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active === item.id}
              onClick={() => setActive(item.id)}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </nav>
      </header>
      {tab.id === 'longcat' ? (
        <OfficialTabBody
          t={t}
          view={view}
          showModelParams={tab.showModelParams}
          showThinkSwitch={tab.showThinkSwitch}
          thinkValue={thinkLongcat}
          onThink={onThinkLongcat}
          apiKey={apiKeyDraft}
          onApiKey={setApiKeyDraft}
          onSaveKey={onSaveKey}
        />
      ) : (
        <CatpawTabBody
          t={t}
          status={channelB}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      )}
    </section>
  )
}
