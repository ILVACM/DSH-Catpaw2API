/**
 * Host 半侧的 Cordis 依赖门契约。
 *
 * ## 为什么需要它
 *
 * `apply` 里直接访问 `ctx.llm.registerAdapter(...)`。Cordis 对**未声明 inject**
 * 的服务做抛错式访问保护（`cannot get property "llm" without inject`），于是
 * `apply` 一进来就失败：provider 从未注册，模型选择器里没有本插件的模型，
 * 而界面上只表现为"没有选项"，不会红屏 —— 极难定位。
 *
 * 0.1.0~0.1.4 就漏了这条 `inject`。本测试把它钉住：以后任何人删掉或改错，
 * 构建产物里立刻红。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_ENTRY = resolve(ROOT, 'lib', 'index.js')

describe('host inject contract', () => {
  it('Host 半侧声明 inject = ["llm"]（否则 apply 访问 ctx.llm 会抛错）', async () => {
    // 优先读构建产物里的导出（与宿主实际加载的是同一份）。
    const mod = (await import(HOST_ENTRY)) as { inject?: unknown }
    expect(Array.isArray(mod.inject), 'Host 入口必须导出 inject 数组').toBe(true)
    expect(mod.inject as string[]).toContain('llm')
  })

  it('源码里直接访问 ctx.llm，因此 inject 必须含 llm', () => {
    const source = readFileSync(resolve(ROOT, 'src', 'index.ts'), 'utf8')
    const accessesLlm = /\bhost\.llm\.|\bctx\.llm\./.test(source)
    expect(accessesLlm, '若不再直接访问 ctx.llm，本测试与 inject 声明都应重新评估').toBe(true)
    expect(source).toMatch(/export const inject\s*=\s*\[[^\]]*['"]llm['"]/)
  })
})
