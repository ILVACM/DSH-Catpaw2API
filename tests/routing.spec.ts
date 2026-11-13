/**
 * §7-T4 / routing.spec.ts —— 前缀分流契约（§3.4）单测。
 * 只测纯函数，不发网络、不依赖宿主。
 */
import { describe, expect, it } from 'vitest'
import {
  channelOf,
  stripPrefix,
  isChannelBEnabled,
} from '../src/routing.ts'

describe('channelOf —— 按前缀分流', () => {
  it('longcat/ 前缀 → longcat', () => {
    expect(channelOf('longcat/LongCat-2.5')).toBe('longcat')
  })

  it('catpaw/ 前缀 → catpaw（阶段一仍返回 catpaw，下游处理器回占位）', () => {
    expect(channelOf('catpaw/glm-5.2')).toBe('catpaw')
  })

  it('无前缀 / 未知前缀 → null', () => {
    expect(channelOf('LongCat-2.5')).toBeNull()
    expect(channelOf('other/model')).toBeNull()
    expect(channelOf('')).toBeNull()
  })
})

describe('stripPrefix —— 去掉两个已知前缀之一', () => {
  it('去掉 longcat/', () => {
    expect(stripPrefix('longcat/LongCat-2.5')).toBe('LongCat-2.5')
  })

  it('去掉 catpaw/', () => {
    expect(stripPrefix('catpaw/glm-5.2')).toBe('glm-5.2')
  })

  it('无前缀原样返回', () => {
    expect(stripPrefix('LongCat-2.5')).toBe('LongCat-2.5')
    expect(stripPrefix('other/model')).toBe('other/model')
  })
})

describe('isChannelBEnabled —— 阶段二恒 true', () => {
  it('返回 true（可用性由设置页状态检测承担，不控制选择器显示）', () => {
    expect(isChannelBEnabled()).toBe(true)
  })
})
