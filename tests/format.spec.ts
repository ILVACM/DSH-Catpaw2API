/**
 * 展示层数字格式化契约（formatTokens）。
 * 这些断言同时是 UI 上「上下文 x.xxM」的规格说明。
 */
import { describe, expect, it } from 'vitest'
import { formatTokens } from '../src/client/format.ts'

describe('formatTokens —— 上下文窗口显示格式', () => {
  it('1048576（= 1×2^20）显示为 1.00M', () => {
    expect(formatTokens(1048576)).toBe('1.00M')
  })

  it('262144 显示为 0.25M', () => {
    expect(formatTokens(262144)).toBe('0.25M')
  })

  it('524288 显示为 0.50M（补零，不是 0.5M）', () => {
    expect(formatTokens(524288)).toBe('0.50M')
  })

  it('非法输入一律显示破折号，不抛错、不显示 NaN', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      expect(formatTokens(bad)).toBe('—')
    }
  })
})
