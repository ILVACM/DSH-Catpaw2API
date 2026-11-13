import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT_ENTRY = resolve(ROOT, 'lib', 'client.js')

/**
 * The browser half must activate through the shell module-loader wrapper and
 * must not carry a bundled copy of react-dom's development build. This spec is
 * intentionally build-artifact based; T6 runs it after the full build.
 */
describe('client runtime imports', () => {
  it('lib/client.js is built with the shell wrapper and external react-dom', () => {
    expect(existsSync(CLIENT_ENTRY)).toBe(true)
    const text = readFileSync(CLIENT_ENTRY, 'utf8')
    expect(text).toContain('window.__ModuleLoader__.load(')
    expect(text).toContain('id: "dsh-connect-catpaw"')
    // A bundled react-dom development build leaks this characteristic guard.
    expect(text).not.toContain('process.env.NODE_ENV')
  })

  /**
   * 0.1.0 把设置卡注册到 `settings.plugin.item`，而该槽位在 DSH 0.1.7 起已被
   * 删除 —— 宿主对不存在的槽位只等待、不报错，所以界面只是"什么都没出现"。
   * 这条断言把"构建产物里不许再出现旧槽位名"钉住（详见 client-slot-contract.spec.ts）。
   */
  it('构建产物不含任何已废弃槽位名', () => {
    const code = readFileSync(CLIENT_ENTRY, 'utf8')
    for (const bad of ['settings.plugin.item', 'plugins.bundle.config', 'plugins.row.config']) {
      expect(code.includes(bad), `构建产物仍含已废弃槽位 "${bad}"`).toBe(false)
    }
  })
})
