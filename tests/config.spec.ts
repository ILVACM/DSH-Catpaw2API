/**
 * §7-T4 / config.spec.ts —— Config schema（§3.2）默认值与逐模型档位持久化单测。
 * 读的是 schema 解析结果（不是手搓对象）：`Config({...})` 由 schemastery 补齐默认值。
 */
import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'
import { KEY_ENV_VAR } from '../src/routing.ts'

/**
 * 解析一份（可能为空的）配置，拿到补齐默认值后的对象。
 *
 * `Config` 的字段都标了 `.volatile()`（设置页表单需要，见 src/config.ts 注释），
 * 所以 `Config(...)` 解析出来的是 `Volatile<T>` 包装；这里按 cosmokit 的
 * `plainConfig` 语义递归 `.get()` 解包，拿到普通值再断言。
 */
function plain(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    return plain((value as { get(): unknown }).get())
  }
  if (Array.isArray(value)) return value.map(plain)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]))
  }
  return value
}

function resolve(patch: Record<string, unknown> = {}): Record<string, any> {
  return plain(Config(patch as never)) as Record<string, any>
}

describe('Config —— 字段默认值', () => {
  it('apiKey 默认空串、apiKeyEnv 默认为环境变量名（不存值）', () => {
    const c = resolve()
    expect(c.apiKey).toBe('')
    expect(c.apiKeyEnv).toBe(KEY_ENV_VAR)
  })

  it('lastCatalog 默认空数组', () => {
    expect(resolve().lastCatalog).toEqual([])
  })
})

describe('Config —— 决策 3 / F9 两个思考开关', () => {
  it('thinkLongcat 默认 true（官方跟随上游默认）', () => {
    expect(resolve().thinkLongcat).toBe(true)
  })

  it('thinkCatpaw 默认 true（妙手占位定值）', () => {
    expect(resolve().thinkCatpaw).toBe(true)
  })

  it('两个开关互不联动：改一个不动另一个', () => {
    const c = resolve({ thinkLongcat: false })
    expect(c.thinkLongcat).toBe(false)
    expect(c.thinkCatpaw).toBe(true)
  })
})

describe('Config —— 决策 4b / F10 channelB', () => {
  it('channelB.enabled 阶段一恒 false', () => {
    expect(resolve().channelB.enabled).toBe(false)
  })

  it('channelB.catalog 默认空数组、credits 恒 null', () => {
    const c = resolve()
    expect(c.channelB.catalog).toEqual([])
    expect(c.channelB.credits).toBeNull()
  })

  it('channelB.contextTiers 默认 {}', () => {
    expect(resolve().channelB.contextTiers).toEqual({})
  })

  it('逐模型档位可存：按带前缀模型 id 记住选中档位', () => {
    const c = resolve({
      channelB: {
        contextTiers: {
          'catpaw/glm-5.2': '1M',
          'catpaw/other': '200K',
        },
      },
    })
    expect(c.channelB.contextTiers['catpaw/glm-5.2']).toBe('1M')
    expect(c.channelB.contextTiers['catpaw/other']).toBe('200K')
  })

  it('逐模型档位独立：只写一个模型不会带出别的模型', () => {
    const c = resolve({ channelB: { contextTiers: { 'catpaw/glm-5.2': '500K' } } })
    expect(Object.keys(c.channelB.contextTiers)).toEqual(['catpaw/glm-5.2'])
  })
})
