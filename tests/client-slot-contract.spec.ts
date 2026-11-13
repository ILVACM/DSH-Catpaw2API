import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 槽位契约测试：构建产物里注册的槽位名，必须是当前宿主真实存在的那些。
 *
 * ## 为什么需要它
 *
 * 阶段一的 40 个测试全绿，却没有一个能发现「注册了宿主已删除的槽位」——
 * `client-runtime-imports.spec.ts` 只验证构建产物带 ModuleLoader banner，
 * 其余测试全跑在 Node 里、根本不接触浏览器槽位。于是 0.1.0 把设置卡注册到
 * `settings.plugin.item`（DSH 0.1.7 起删除）后，**零告警**装进宿主，
 * 界面上只是"什么都没出现"。
 *
 * `ctx.slots.inject()` 的语义是「等宿主声明该槽位，声明后执行回调」，所以
 * 槽位不存在时它**只等待、不抛错**——这是最难发现的一类缺陷。本测试把它
 * 变成一条会红的断言。
 *
 * ## 边界（诚实说明）
 *
 * 它验证的是「我们没写错槽位名」，不是「宿主一定渲染出来」。宿主升级若删除
 * 某槽位，白名单需人工同步——把清单写在这里，就是为了让这次同步成为一次
 * **显式修改**，而不是又一次静默失效。
 */

/** 与 client-runtime-imports.spec.ts 相同的路径风格。 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT_ENTRY = resolve(ROOT, 'lib', 'client.js')

/** 宿主实际支持的槽位（实测自 app.asar；新增槽位必须先核实宿主声明再改这里）。 */
const HOST_SLOTS = new Set(['settings.section', 'settings.section.icon'])

/** 已废弃、绝不能出现的旧槽位（踩过一次坑，永久拉黑）。 */
const FORBIDDEN_SLOTS = new Set([
  'settings.plugin.item', // DSH 0.1.7 起删除
  'plugins.bundle.config', // 同一轮迁移中被移除
  'plugins.row.config',
])

describe('client slot contract', () => {
  it('只注册宿主真实存在的槽位，且不出现任何已废弃槽位', () => {
    const code = readFileSync(CLIENT_ENTRY, 'utf8')
    const names = new Set<string>()
    for (const re of [
      /slots\.inject\(\s*["']([^"']+)["']/g,
      /name:\s*["'](settings\.[^"']+|plugins\.[^"']+)["']/g,
    ]) {
      let m: RegExpExecArray | null
      while ((m = re.exec(code)) !== null) names.add(m[1]!)
    }
    expect(names.size, '未从构建产物提取到任何槽位名（构建可能失败）').toBeGreaterThan(0)
    for (const n of names) {
      expect(FORBIDDEN_SLOTS.has(n), `注册了已废弃槽位 "${n}"`).toBe(false)
      expect(
        HOST_SLOTS.has(n),
        `注册了宿主不存在的槽位 "${n}"（白名单：${[...HOST_SLOTS].join(', ')}）`,
      ).toBe(true)
    }
  })
})
