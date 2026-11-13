/**
 * 模型显示名契约：选择器里必须能看出模型属于哪个通道。
 *
 * 宿主渲染 `model.name`（不是 id），所以 name 必须带 `longcat/` 前缀。
 * 这里直接断言 adapter 的真实映射函数，而不是断言常量 —— 只断言常量
 * 会在"函数改坏了但常量没变"时仍然绿。
 */
import { describe, expect, it } from 'vitest'
import { toPiModel } from '../src/adapter.ts'
import { LONGCAT_CATALOG_FALLBACK } from '../src/routing.ts'

describe('模型显示名带通道前缀', () => {
  it('toPiModel 产出的 name 与 id 一致，且带 longcat/ 前缀', () => {
    const entry = LONGCAT_CATALOG_FALLBACK[0]!
    const model = toPiModel(entry, 'http://127.0.0.1:1/v1', 'dsh-connect-catpaw')
    expect(model.name).toBe(entry.id)
    expect(model.name.startsWith('longcat/')).toBe(true)
    // 路由键本身不受影响
    expect(model.id).toBe(entry.id)
  })

  it('所有官方目录条目的显示名都带 longcat/ 前缀', () => {
    for (const entry of LONGCAT_CATALOG_FALLBACK) {
      const model = toPiModel(entry, 'http://127.0.0.1:1/v1', 'dsh-connect-catpaw')
      expect(model.name.startsWith('longcat/')).toBe(true)
    }
  })
})
