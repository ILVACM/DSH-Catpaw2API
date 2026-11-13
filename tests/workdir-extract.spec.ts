/**
 * 工作目录提取测试（0.2.1 修复的核心）。
 *
 * 背景：DSH 发给模型的请求体是**标准 OpenAI 形状**，里面**没有** `workingDir` 字段。
 * 宿主 `@deepseek-ai/dsh-working-directory` 把实时目录写进 system prompt：
 *
 *     Current working directory: "D:\\DSH-Catpaw2API".
 *
 * 所以 shim 必须从 `messages` 里把这句话捞出来。这组测试钉住三件事：
 *   1. 能从真实形状的请求里提取到路径（含转义、含中文/空格）；
 *   2. 提取不到时返回 undefined（**绝不** fallback 到 process.cwd()）；
 *   3. 显式 `workingDir` 字段优先级更高（兼容旧行为）。
 *
 * @module tests/workdir-extract
 */

import { describe, expect, it } from 'vitest'
import { extractWorkingDir } from '../src/shim.ts'

/** 构造一条 system 消息，正文里带宿主注入的工作目录行。 */
function systemWithDir(dir: string): Record<string, unknown> {
  return {
    role: 'system',
    content: `You are a helpful assistant.\nCurrent working directory: ${JSON.stringify(dir)}.\nFollow the rules.`,
  }
}

describe('extractWorkingDir —— 从 system prompt 提取（主路径）', () => {
  it('标准 OpenAI 请求（无 workingDir 字段）能从 system 消息里提取路径', () => {
    const body = {
      model: 'catpaw/LongCat-2.5',
      stream: true,
      messages: [
        systemWithDir('D:\\DSH-Catpaw2API'),
        { role: 'user', content: '列出当前目录' },
      ],
    }

    expect(extractWorkingDir(body)).toBe('D:\\DSH-Catpaw2API')
  })

  it('content 是数组形状（[{type:text,text}]）也能提取', () => {
    const body = {
      messages: [
        {
          role: 'system',
          content: [
            { type: 'text', text: 'Current working directory: "C:\\\\work\\\\demo".' },
          ],
        },
        { role: 'user', content: 'hi' },
      ],
    }

    expect(extractWorkingDir(body)).toBe('C:\\work\\demo')
  })

  it('含空格与中文的路径能正确还原', () => {
    const dir = 'D:\\我的 项目\\demo app'
    const body = { messages: [systemWithDir(dir), { role: 'user', content: 'hi' }] }

    expect(extractWorkingDir(body)).toBe(dir)
  })

  it('工作目录行出现在多条 system 消息之一时仍能命中', () => {
    const body = {
      messages: [
        { role: 'system', content: 'first system prompt' },
        { role: 'developer', content: 'Current working directory: "E:\\\\repo".' },
        { role: 'user', content: 'hi' },
      ],
    }

    expect(extractWorkingDir(body)).toBe('E:\\repo')
  })
})

describe('extractWorkingDir —— 显式字段优先', () => {
  it('body.workingDir 存在时优先于 messages 里的值', () => {
    const body = {
      workingDir: 'F:\\explicit',
      messages: [systemWithDir('D:\\from-prompt'), { role: 'user', content: 'hi' }],
    }

    expect(extractWorkingDir(body)).toBe('F:\\explicit')
  })
})

describe('extractWorkingDir —— 拿不到时返回 undefined（绝不猜）', () => {
  it('没有 messages 时返回 undefined', () => {
    expect(extractWorkingDir({ model: 'catpaw/LongCat-2.5' })).toBeUndefined()
  })

  it('messages 里没有工作目录行时返回 undefined（不回落 process.cwd()）', () => {
    const body = {
      messages: [
        { role: 'system', content: 'no directory here' },
        { role: 'user', content: 'hi' },
      ],
    }

    expect(extractWorkingDir(body)).toBeUndefined()
  })

  it('空字符串的 workingDir 视为缺失，继续看 messages', () => {
    const body = {
      workingDir: '   ',
      messages: [systemWithDir('D:\\fallback-ok'), { role: 'user', content: 'hi' }],
    }

    expect(extractWorkingDir(body)).toBe('D:\\fallback-ok')
  })
})
