import type { CatalogEntry, ChannelId, ContextTier } from './contracts.ts'

// §3.1 路径与标识（全仓唯一，技术标识原样保留）
export const PLUGIN_ID = 'dsh-connect-catpaw'
export const PACKAGE_NAME = 'dsh-connect-catpaw'
export const PROVIDER_ROUTE = 'dsh-connect-catpaw'
export const PREFIX_LONGCAT = 'longcat/'
export const PREFIX_CATPAW = 'catpaw/'
export const LONGCAT_MODEL_ID = 'LongCat-2.5'
export const LONGCAT_BASE_URL = 'https://api.longcat.chat/openai/v1'
export const LONGCAT_MODELS_URL = 'https://api.longcat.chat/openai/v1/models'
export const LONGCAT_MODEL_DETAIL_URL = 'https://api.longcat.chat/openai/v1/models/'
export const KEY_ENV_VAR = 'LONGCAT_API_KEY'
export const KEY_SETTING_PATH = ['apiKey']
export const VERSION_DEFINE = '__DSH_CATPAW_VERSION__'

export function channelOf(modelId: string): ChannelId | null {
  // 规则（逐字）：modelId 以 "longcat/" 开头 → 'longcat'；以 "catpaw/" 开头 → 'catpaw'；否则 → null
  // 阶段一：channelOf('catpaw/...') 仍返回 'catpaw'，但下游 B 处理器返回 NOT_IMPLEMENTED（见 §3.5）
  if (modelId.startsWith(PREFIX_LONGCAT)) return 'longcat'
  if (modelId.startsWith(PREFIX_CATPAW)) return 'catpaw'
  return null
}

export function stripPrefix(modelId: string): string {
  // 去掉前两个前缀之一，返回剩余部分；无前缀原样返回
  if (modelId.startsWith(PREFIX_LONGCAT)) return modelId.slice(PREFIX_LONGCAT.length)
  if (modelId.startsWith(PREFIX_CATPAW)) return modelId.slice(PREFIX_CATPAW.length)
  return modelId
}

export function isChannelBEnabled(): boolean {
  // 阶段二起恒 true：B 通道能力已实现，可用性由设置页状态检测承担，
  // 不用"是否启用"来控制选择器显示（plan.md §3.4：常驻显示）。
  return true
}

export const LONGCAT_CATALOG_FALLBACK: CatalogEntry[] = [
  { id: 'longcat/LongCat-2.5', provider: 'longcat', name: 'LongCat-2.5',
    contextWindow: 1048576, maxTokens: 262144, input: ['text','image'],
    supportedParameters: ['max_tokens','temperature','top_p','stream','tools','tool_choice','thinking'],
    pricing: { prompt: '2', completion: '8', cached_tokens: '0.04' },
    detailSource: 'fallback' },
]
// 决策 2：仅在"模型列表或详情接口失败/401"时作为兜底，detailSource 置 'fallback'
// 并在 UI 标注"回落/兜底"，不得冒充实时结果。模态口径（docs/longcat.md §3）：
// 以 supportedParameters / 官方 DSH 配置页为准，取 input:['text','image']，
// 不凭 architecture.input_modalities 单字段断定纯文本。
// 注意：官方 FALLBACK **不带** contextTiers/contextTier（F10 只针对 B）。

/** 妙手免费的默认模型在本地 Agent Server 里的数字 ID（云端 model-types 的 modelTypeId）。 */
export const CATPAW_FREE_MODEL_ID = 10002544

/**
 * B 通道模型名的**唯一来源**（plan.md §3.4 单一数据源约束）。
 * 选择器显示 `catpaw/<此值>`；设置页显示 `<此值>`（不带前缀）。
 * 禁止在其它文件再写一份 'LongCat-2.5' 字面量。
 */
export const CATPAW_MODEL_NAME = 'LongCat-2.5'

/** B 通道模型完整 id（选择器路由键）：`catpaw/LongCat-2.5`。 */
export const CATPAW_MODEL_ID = `${PREFIX_CATPAW}${CATPAW_MODEL_NAME}`

/** B 通道单一模型条目（替换原占位清单）。 */
export const CATPAW_CATALOG: CatalogEntry[] = [
  {
    id: CATPAW_MODEL_ID,
    provider: 'catpaw',
    name: CATPAW_MODEL_NAME,
    // 实测值：contextWindowTokens=204800、maxOutputTokens=32768（探针 §10）
    contextWindow: 204800,
    maxTokens: 32768,
    input: ['text'],
  },
]
