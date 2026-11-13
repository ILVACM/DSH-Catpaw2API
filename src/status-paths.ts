// 路由常量 + DTO 契约中心，node-free（不含任何 Node 内置模块 import，客户端亦可引用）
import { PLUGIN_ID } from './routing.ts'

export const STATUS_PATH = '/api/dsh-connect-catpaw/status'
export const TABS_PATH = '/api/dsh-connect-catpaw/tabs'
export const REFRESH_PATH = '/api/dsh-connect-catpaw/refresh'
export const SETTINGS_NS = [PLUGIN_ID]

// 从 contracts.ts 转出 DTO，供 web-status / client 等按字面量 import
export type { TabView, CreditsView, CatalogEntry, ContextTier } from './contracts.ts'

// ── 设置面板契约（DSH 0.1.7 起用 settings.section；旧的分区槽位已删除）──
// 注意：本文件会进构建产物，注释里刻意不复述已废弃的旧槽位字面量，
// 否则 tests/client-slot-contract.spec.ts 会把它判为违规。

/**
 * 本插件设置页在宿主设置导航里的分区 id，同时也是图标槽位的地址。
 *
 * 复用 PLUGIN_ID（= 'dsh-connect-catpaw'）而不是另写字面量：section 的 `id`
 * 与 `settings.section.icon` 的 `id` 必须**完全相同**才会命中（宿主按
 * `renderSlot('settings.section.icon', …, { only: row.id })` 精确匹配），
 * 复用同一个常量让这个配对是结构性的、而不是靠人记。
 *
 * 注意它**不是** Loader entry id 的拼写候选（那些见
 * {@link CATPAW_SETTINGS_NAMESPACE_CANDIDATES}）：这个 id 是我们自己拥有的，
 * 必须在任何部署形态下都稳定。
 */
export const CATPAW_SETTINGS_SECTION_ID = PLUGIN_ID

/**
 * 设置分区的排序值。
 *
 * 宿主内置分区：account = -10 / general = 0 / models = 10 / plugins = 15 /
 * agent-presets = 20。本插件排在它们之后（与 dsh-connect-workbuddy 的 35 对齐）。
 */
export const CATPAW_SETTINGS_SECTION_ORDER = 35

/**
 * 宿主可能用于本插件设置表单的 Loader entry id 拼写，按优先级排列。
 *
 * `configForms.describe()` 按 **Loader entry id** 给表单命名，而 entry id 由
 * profile patch 决定 —— 所以必须**问**宿主实际服务了哪个，不能假设。
 * 观察到的拼写：裸包名、Desktop 宿主使用的 `include:` 包裹形式。
 */
export const CATPAW_SETTINGS_NAMESPACE_CANDIDATES: readonly string[] = [
  PLUGIN_ID,
  `include:${PLUGIN_ID}`,
]
