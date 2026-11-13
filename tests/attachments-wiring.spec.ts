/**
 * 附件服务接线测试（0.2.2 修复的核心）。
 *
 * ## 这个 bug 的形态
 *
 * `dsh-llm-pi-ai` 的 `PiAiAdapter` 在消息含图片时要求 config 里有
 * `resolveAttachments`，否则抛：
 *
 *     pi-ai image input requires the durable attachment service
 *
 * `src/adapter.ts` 一直**能**透传该字段；真正的断点在 `src/index.ts` ——
 * 它调用 `createAdapter({ shim, liveModels })` 时**从来没传** `resolveAttachments`，
 * 所以条件传参永远是"不传"。
 *
 * ## 因此这组测试钉两件事
 *
 * 1. **adapter 层**：传了就能取到、且是活读（服务晚到也能拿到）；
 * 2. **index 层**：源码里必须真的把 `attachments` 服务注入并传给 `createAdapter`
 *    —— 用源码断言把这条接线钉死，防止回退。
 *
 * @module tests/attachments-wiring
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAdapter } from '../src/adapter.ts'
import type { CatpawShim } from '../src/shim.ts'

/** 最小 shim 替身：只提供 adapter 构造所需的两个方法。 */
function stubShim(): CatpawShim {
  return {
    ready: Promise.resolve(),
    baseUrl: () => 'http://127.0.0.1:1',
    token: () => 'test-token',
    close: async () => {},
  }
}

/** 一个形状上够用的假附件存储（不实现真实方法，只验传递与活读）。 */
function fakeAttachmentStore(): unknown {
  return { __fake: 'attachment-store' }
}

/** 读取本仓源码文本（用于接线断言）。 */
function readSource(relative: string): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return readFileSync(join(here, '..', 'src', relative), 'utf8')
}

describe('createAdapter —— resolveAttachments 透传', () => {
  it('传入后，adapter 的 config 能取到同一个 store', () => {
    const store = fakeAttachmentStore()
    const built = createAdapter({
      shim: stubShim(),
      resolveAttachments: () => store as never,
    })

    const config = (built.adapter as unknown as {
      config?: { resolveAttachments?: () => unknown }
    }).config

    expect(config?.resolveAttachments).toBeTypeOf('function')
    expect(config?.resolveAttachments?.()).toBe(store)
  })

  it('是活读：构造后再赋值，调用时能拿到新值（服务可能晚于构造出现）', () => {
    let store: unknown
    const built = createAdapter({
      shim: stubShim(),
      resolveAttachments: () => store as never,
    })

    const config = (built.adapter as unknown as {
      config?: { resolveAttachments?: () => unknown }
    }).config

    expect(config?.resolveAttachments?.()).toBeUndefined()
    store = fakeAttachmentStore()
    expect(config?.resolveAttachments?.()).toBe(store)
  })

  it('未传时 config 上不应有该字段（不伪造）', () => {
    const built = createAdapter({ shim: stubShim() })

    const config = (built.adapter as unknown as {
      config?: { resolveAttachments?: unknown }
    }).config

    expect(config?.resolveAttachments).toBeUndefined()
  })
})

describe('index.ts —— 必须真的接线（防回退）', () => {
  it('注入 attachments 服务', () => {
    const source = readSource('index.ts')
    expect(source).toContain("inject(['attachments']")
  })

  it('把 resolveAttachments 传给 createAdapter', () => {
    const source = readSource('index.ts')
    // createAdapter({ ... resolveAttachments: ... }) —— 允许换行与空白差异。
    const createAdapterCall = source.slice(source.indexOf('createAdapter({'))
    const callBody = createAdapterCall.slice(0, createAdapterCall.indexOf('})') + 2)
    expect(callBody).toContain('resolveAttachments')
  })

  it('用活读取值器而非一次性快照（否则服务晚到就永远拿不到）', () => {
    const source = readSource('index.ts')
    // 期望形如：resolveAttachments: () => attachmentStore
    expect(source).toMatch(/resolveAttachments:\s*\(\)\s*=>/)
  })
})
