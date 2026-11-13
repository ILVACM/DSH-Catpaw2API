/**
 * 图片输入回归测试（0.2.2 的验收钉子）。
 *
 * 用户遇到的报错：
 *
 *     pi-ai image input requires the durable attachment service
 *
 * 它来自 `@deepseek-ai/dsh-llm-pi-ai` 的这段逻辑：
 *
 *     const containsImage = options.messages.some(m => contentHasImage(m.content))
 *     const attachments = containsImage ? this.config.resolveAttachments?.() : undefined
 *     if (containsImage && attachments === undefined) throw new LlmError(...)
 *
 * 本测试不依赖 pi-ai 的内部运行环境，而是直接**在依赖产物里断言这条契约仍然存在**：
 * 若上游改了行为（例如不再需要附件服务、或改了字段名），这里会红，提示我们复核
 * 接线是否仍然正确 —— 这比"假装跑通一次图片请求"更稳定，也更诚实。
 *
 * @module tests/image-input
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

/** 定位已安装的 `dsh-llm-pi-ai` 主入口文件路径。 */
function piAiEntry(): string | null {
  try {
    return require.resolve('@deepseek-ai/dsh-llm-pi-ai')
  } catch {
    return null
  }
}

describe('pi-ai 图片输入契约（防上游变更）', () => {
  it('依赖可解析（宿主包存在）', () => {
    expect(piAiEntry()).not.toBeNull()
  })

  it('仍要求 resolveAttachments —— 证明接线是必需的', () => {
    const entry = piAiEntry()
    expect(entry).not.toBeNull()
    const source = readFileSync(entry as string, 'utf8')

    // 钉住触发条件：含图片且拿不到附件服务 → 抛错。
    expect(source).toContain('durable attachment service')
    expect(source).toContain('resolveAttachments')
  })

  it('报错文案与排查文档一致（避免上游悄悄改文案）', () => {
    const entry = piAiEntry()
    const source = readFileSync(entry as string, 'utf8')
    expect(source).toContain('pi-ai image input requires the durable attachment service')
  })

  it('图片判定走 model.input 而非硬编码（我们声明了 image，故不会先撞这一条）', () => {
    const entry = piAiEntry()
    const source = readFileSync(entry as string, 'utf8')
    // 存在"模型不支持图片"的分支，说明 input 声明是有意义的。
    expect(source).toContain('does not support image input')
  })
})
