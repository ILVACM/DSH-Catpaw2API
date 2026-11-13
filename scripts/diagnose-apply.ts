/**
 * 诊断脚本：用最小 fake context 实跑插件的 `apply`，看它是否抛错。
 *
 * 宿主调用 `apply(ctx, config)` 时如果抛异常，整个插件不会注册任何东西
 * —— provider 不出现、模型列表为空。这里把每一步都打出来。
 *
 * 只做只读诊断，不发网络请求、不写文件。
 */
import { apply } from '../src/index.ts'
import { Config } from '../src/config.ts'

const log = (msg: string): void => { console.log(msg) }

const main = (): void => {
  log('=== 构造最小 fake context ===')
  const effects: Array<() => void> = []
  const calls: string[] = []

  const makeCtx = (): Record<string, unknown> => {
    const ctx: Record<string, unknown> = {}
    ctx.logger = {
      info: (m: unknown) => log(`  [info] ${String(m)}`),
      warn: (m: unknown) => log(`  [warn] ${String(m)}`),
      error: (m: unknown, e?: unknown) => log(`  [error] ${String(m)} ${e === undefined ? '' : String(e)}`),
      debug: () => {},
    }
    ctx.fiber = { entry: { options: { id: 'dsh-connect-catpaw' } }, state: 'active', runtime: {}, ctx }
    ctx.effect = (fn: () => unknown) => {
      const dispose = fn()
      if (typeof dispose === 'function') effects.push(dispose as () => void)
      return dispose
    }
    ctx.inject = (services: string[], cb: (s: unknown) => void) => {
      calls.push(`inject(${services.join(',')})`)
      // 模拟：settings 与 webServer 都可用
      if (services.includes('settings')) {
        cb({ settings: { configure: () => () => {} } })
      }
      if (services.includes('webServer')) {
        // 故意不调用回调：webServer 注册不影响模型目录
      }
    }
    ctx.get = () => undefined
    ctx.llm = {
      registerAdapter: (ids: string[], adapter: unknown) => {
        calls.push(`registerAdapter(${ids.join(',')})`)
        log(`  >>> registerAdapter 被调用，provider=${ids.join(',')}`)
        return () => {}
      },
      registerConfigurableProviders: (entries: unknown[]) => {
        calls.push('registerConfigurableProviders')
        log(`  >>> registerConfigurableProviders 被调用，${(entries as unknown[]).length} 条`)
        return () => {}
      },
      registerModelDiscovery: (ns: string) => {
        calls.push(`registerModelDiscovery(${ns})`)
        log(`  >>> registerModelDiscovery 被调用，ns=${ns}`)
        return () => {}
      },
    }
    return ctx
  }

  log('\n=== 解析 Config ===')
  const config = Config({}) as unknown as never
  log(`  Config 解析成功`)

  log('\n=== 调用 apply(ctx, config) ===')
  try {
    apply(makeCtx() as never, config)
    log('  apply 返回，未同步抛错')
  } catch (error) {
    log(`  >>> apply 同步抛错：${(error as Error)?.message ?? String(error)}`)
    log(`  stack: ${(error as Error)?.stack?.split('\n').slice(0, 8).join('\n')}`)
    return
  }

  log('\n=== 等异步注册链完成（2 秒）===')
  setTimeout(() => {
    log('\n=== 注册调用序列 ===')
    for (const c of calls) log(`  - ${c}`)
    const registered = calls.some(c => c.startsWith('registerAdapter'))
    log(`\n>>> registerAdapter 是否被调用：${registered ? '是（正常）' : '否（这就是模型不显示的原因）'}`)
    for (const d of effects) { try { d() } catch { /* ignore */ } }
  }, 2000)
}

main()
