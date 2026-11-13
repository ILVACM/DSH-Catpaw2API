/**
 * 妙手 / LongCat 设置卡文案（zh / en）。
 *
 * 产品中文名统一「妙手」（§3.8）；技术标识 catpaw/ 等原样保留。
 * 值与 §3.7 假值 / 回落 / 占位文案一致，不含任何真实账号 / 余额 / 路径 / token。
 * 决策 1：不得含任何官方余额文案键。
 */

export type CatpawSettingsKey =
  | 'card.title'
  | 'tab.longcat'
  | 'tab.catpaw'
  | 'refresh'
  | 'key.input'
  | 'think.switch'
  | 'think.on'
  | 'think.off'
  | 'save'
  | 'saved'
  | 'nav.label'
  | 'scope.unavailable'
  | 'model.context'
  | 'model.input'
  | 'model.output'
  | 'model.fallback.short'
  | 'channelb.model'
  | 'channelb.status'
  | 'channelb.available'
  | 'channelb.unavailable'
  | 'channelb.checking'
  | 'channelb.refresh'
  | 'channelb.risk'

const zhDict = {
  'card.title': '妙手 / LongCat 设置',
  'tab.longcat': 'LongCat 官方',
  'tab.catpaw': '本地客户端通道复用',
  'refresh': '手动刷新',
  'key.input': '填 / 存 LongCat API Key',
  'think.switch': '深度思考',
  'think.on': '开',
  'think.off': '关',
  'save': '保存',
  'saved': '已保存',
  'nav.label': '妙手',
  'scope.unavailable': '无法读取插件配置（宿主未提供配置服务），当前为只读。',
  'model.context': '上下文',
  'model.input': '输入',
  'model.output': '输出',
  'model.fallback.short': '兜底',
  'channelb.model': '当前模型',
  'channelb.status': '状态',
  'channelb.available': '可用',
  'channelb.unavailable': '不可用',
  'channelb.checking': '检测中…',
  'channelb.refresh': '刷新状态',
  'channelb.risk': '该通道的模型会自行读取工作目录内文件并执行命令，其工具调用不受 DSH 控制。',
} as const satisfies Record<string, string>

const enDict = {
  'card.title': '妙手 / LongCat Settings',
  'tab.longcat': 'LongCat Official',
  'tab.catpaw': '本地客户端通道复用',
  'refresh': 'Refresh',
  'key.input': 'Enter / Save LongCat API Key',
  'think.switch': 'Deep Thinking',
  'think.on': 'On',
  'think.off': 'Off',
  'save': 'Save',
  'saved': 'Saved',
  'nav.label': '妙手',
  'scope.unavailable': 'Plugin settings are unavailable (host provides no config service); this view is read-only.',
  'model.context': 'Context',
  'model.input': 'Input',
  'model.output': 'Output',
  'model.fallback.short': 'fallback',
  'channelb.model': 'Model',
  'channelb.status': 'Status',
  'channelb.available': 'Available',
  'channelb.unavailable': 'Unavailable',
  'channelb.checking': 'Checking…',
  'channelb.refresh': 'Refresh',
  'channelb.risk': "This channel's model reads files and runs commands on its own; its tool calls are not controlled by DSH.",
} as const satisfies Record<string, string>

export const zh: Record<CatpawSettingsKey, string> = zhDict as Record<CatpawSettingsKey, string>
export const en: Record<CatpawSettingsKey, string> = enDict as Record<CatpawSettingsKey, string>
