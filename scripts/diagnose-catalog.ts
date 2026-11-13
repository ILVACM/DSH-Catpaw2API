/**
 * 诊断脚本：模拟宿主 `describe()` + `buildModelCatalog` 的完整链路，
 * 找出模型为何不出现在选择器里。
 *
 * 重点验证：`registerConfigurableProviders` 的 settingsNs 与
 * `settings.describe()` 返回的 ns 是否**精确匹配**（宿主按字符串相等查表）。
 */
import { settingsNamespaceOf } from '../src/index.ts'
import { Config } from '../src/config.ts'

const log = (m: string): void => { console.log(m) }

log('=== 1) settingsNamespaceOf 在各种 ctx 形态下的返回值 ===')
const cases: Array<[string, unknown]> = [
  ['无 fiber', {}],
  ['fiber.entry.options.id = dsh-connect-catpaw', { fiber: { entry: { options: { id: 'dsh-connect-catpaw' } } } }],
  ['fiber.entry.options.id = include:dsh-connect-catpaw', { fiber: { entry: { options: { id: 'include:dsh-connect-catpaw' } } } }],
  ['fiber 无 entry', { fiber: {} }],
]
for (const [name, ctx] of cases) {
  log(`  ${name} -> ${settingsNamespaceOf(ctx)}`)
}

log('\n=== 2) Config 解析后的字段（宿主 describe 会看到什么）===')
const c = Config({}) as unknown as Record<string, unknown>
for (const [k, v] of Object.entries(c)) {
  const isVol = v !== null && typeof v === 'object' && typeof (v as { get?: unknown }).get === 'function'
  log(`  ${k}: volatile=${isVol} value=${JSON.stringify(isVol ? (v as { get(): unknown }).get() : v)}`)
}

log('\n=== 3) volatileForm（宿主 describe 的准入门槛）===')
function volatileForm(s: any): any {
  if (s.meta && s.meta.volatile) return true
  if (s.type === 'object') {
    const keys = Object.entries(s.dict ?? {}).flatMap(([k, ch]: [string, any]) => volatileForm(ch) ? [k] : [])
    return keys.length ? keys : undefined
  }
  return undefined
}
log(`  volatileForm = ${JSON.stringify(volatileForm(Config))}`)
log(`  若为 undefined，宿主 describe() 会直接跳过本插件 -> 命名空间不存在 -> 模型发现失效`)

log('\n=== 4) settingsPath 检查（hasProviderApiKey 读它）===')
log('  我们注册时 settingsPath: []')
log('  hasProviderApiKey 会读 profile.apiKeyEnv 判断凭据是否配置')
log(`  我们 Config 里有 apiKeyEnv，默认值 = ${JSON.stringify((c.apiKeyEnv as string) ?? 'n/a')}`)
