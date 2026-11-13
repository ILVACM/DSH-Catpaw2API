export type ChannelId = 'longcat' | 'catpaw'
export type ContextTier = '200K' | '500K' | '1M'   // 决策 4b：当前已知三档，按读出显示、不写死

export interface CatalogEntry {
  id: string            // 带前缀，例 "longcat/LongCat-2.5" / "catpaw/glm-5.2"（占位）
  provider: ChannelId
  name: string
  contextWindow: number
  maxTokens: number
  input: Array<'text' | 'image'>
  reasoningEfforts?: Record<string, string | null>
  // 决策 2：以下三项由 GET /v1/models/{model} 实时带出；失败/401 回落并标注
  supportedParameters?: string[]
  pricing?: { prompt: string; completion: string; cached_tokens: string }
  detailSource?: 'live' | 'fallback'   // 'live' = 详情接口取回；'fallback' = 静态兜底
  // 决策 4b / F10：逐模型档位（仅妙手通道用；官方 A 不加）
  contextTiers?: ContextTier[]        // 该模型支持的档位，按读出显示
  contextTier?: ContextTier           // 用户为该模型选中的档位
  contextTierSource?: 'live' | 'placeholder'  // 'placeholder' = 阶段一占位列表
}

/** 决策 1：仅用于妙手通道的"剩余 Credits"读数；官方通道无任何余额/读数类型。 */
export interface CreditsView {
  channel: 'catpaw'
  status: 'ok' | 'not_implemented'
  label: string          // 展示用文案 key，固定 "balance.catpaw"
  amount: number | null  // 占位/未实现时恒 null
  unit: 'credit'
  asOf: number | null
  note: string           // 占位时写人话原因，禁止编造数字
}

export interface TabView {
  channel: ChannelId
  credits: CreditsView | null   // 官方 tab 恒 null（决策 1）；妙手 tab 为占位或真实 Credits
  models: CatalogEntry[]
  modelDetailSource?: 'live' | 'fallback' | 'partial'  // 官方 tab：详情接口整体成功/整体回落/部分失败
  placeholder: boolean   // 阶段一 catpaw tab 恒 true
  /** B 通道状态检测结果（官方 tab 不填）。 */
  probe?: { available: boolean; modelName: string; reason: string }
}

export const NOT_IMPLEMENTED = 'NOT_IMPLEMENTED_P1' as const
export type NotImplemented = typeof NOT_IMPLEMENTED
