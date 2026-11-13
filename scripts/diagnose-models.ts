/**
 * 诊断脚本：复现宿主 `buildModelCatalog` 对我们 adapter 的调用，把真实错误打出来。
 *
 * 宿主链路（packages/api/session-controller/src/catalog.ts）：
 *   ctx.llm.listModels(providerId)
 *     → adapter.listModels(providerId)          ← PiAiAdapter
 *         → await resolveApiKey(provider, profile)   ← 抛错就整个 provider 进 failures
 *         → snapshot.models.getModels(provider)
 *
 * 本脚本只做只读复现，不发任何网络请求。
 */
import { createShim } from '../src/shim.ts'
import { createAdapter } from '../src/adapter.ts'
import { LONGCAT_CATALOG_FALLBACK } from '../src/routing.ts'

const step = (name: string, ok: boolean, detail?: unknown): void => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` :: ${String(detail)}`}`)
}

const main = async (): Promise<void> => {
  console.log('=== 1) 创建 shim ===')
  const shim = createShim({ apiKey: () => 'probe-fake-key', thinkLongcat: () => true })
  await shim.ready
  step('shim.ready', true)
  console.log(`     baseUrl = ${shim.baseUrl()}`)
  console.log(`     token   = ${shim.token().slice(0, 8)}... (len ${shim.token().length})`)

  console.log('\n=== 2) 创建 adapter ===')
  const built = createAdapter({ shim, liveModels: () => [] })
  step('createAdapter', true)
  console.log(`     piAiGeneration = ${built.piAiGeneration}`)

  console.log('\n=== 3) 复现 adapter.listModels（宿主 buildModelCatalog 走的路）===')
  try {
    const models = await built.adapter.listModels('dsh-connect-catpaw')
    step('adapter.listModels', true, `返回 ${models.length} 个模型`)
    for (const m of models) console.log(`     - ${m.id} (${m.name})`)
    if (models.length === 0) {
      console.log('     >>> 空数组！宿主会把本 provider 从选择器里去掉 <<<')
    }
  } catch (error) {
    step('adapter.listModels', false, (error as Error)?.message ?? error)
    console.log('     >>> 抛错！宿主会把它归入 failures <<<')
    console.log('     stack:', (error as Error)?.stack?.split('\n').slice(0, 6).join('\n'))
  }

  console.log('\n=== 4) 对照：直接看 buildModels 产出 ===')
  console.log(`     LONGCAT_CATALOG_FALLBACK = ${LONGCAT_CATALOG_FALLBACK.length} 条`)
  console.log(`     fallback ids = ${LONGCAT_CATALOG_FALLBACK.map(e => e.id).join(', ')}`)

  await shim.close()
}

void main().catch((error: unknown) => {
  console.error('DIAGNOSTIC CRASHED:', error)
  process.exit(1)
})
