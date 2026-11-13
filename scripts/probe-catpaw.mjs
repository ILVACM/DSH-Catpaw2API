#!/usr/bin/env node
/**
 * P2 探针实测脚本：验证妙手（CatPaw）本地 Agent Server 的四项核心能力。
 *
 * 依据 temp/P2/code-pre.md §5。走本地 JSON-RPC 2.0 + SSE。
 *
 * ## 安全铁律
 * - 不打印任何 token / 账号 / 手机号，只输出字段名、结构、长度。
 * - 不写任何文件（除 stdout）。
 *
 * ## 费用铁律
 * - 全部实测只用 `longcat-2.5`（免费）。
 * - 每次对话后由 assertFree() 核对：modelDisplayName 必须是 LongCat-2.5，
 *   creditCost 必须是 0.00000000。**不满足立即中止**，防止误用计费模型。
 *
 * Run (from the repository root):
 *   node scripts/probe-catpaw.mjs
 *
 * 退出码：0 = 完成；1 = 有断言失败；2 = 环境前置缺失
 */

import { randomUUID } from 'node:crypto'

/** 候选端口（catpaw-cli.exe server 实测监听 6984/6985）。 */
const PORTS = [6984, 6985, 6986, 6987]

/** 免费模型名（用于断言）。 */
const FREE_MODEL = 'LongCat-2.5'

/** 免费费用字符串。 */
const FREE_COST = '0.00000000'

/** 断言失败计数。 */
let failures = 0

// ─────────────────────────────────────────────────────────────
// 基础工具
// ─────────────────────────────────────────────────────────────

function section(title) {
  process.stdout.write(`\n${'='.repeat(60)}\n${title}\n${'='.repeat(60)}\n`)
}

/** 探测哪个端口是 CatPaw Agent Server。 */
async function findServer() {
  for (const port of PORTS) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) })
      const t = await r.text()
      if (t.includes('CatPaw Agent Server')) return port
    } catch { /* 端口未开，继续 */ }
  }
  return null
}

/** 普通 RPC 调用。 */
async function rpc(port, method, params = {}) {
  const r = await fetch(`http://127.0.0.1:${port}/api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: randomUUID() }),
    signal: AbortSignal.timeout(20000),
  })
  return r.json()
}

/** 流式 RPC（agent.start），逐事件回调。 */
async function rpcStream(port, method, params, onEvent, timeoutMs = 120000) {
  const r = await fetch(`http://127.0.0.1:${port}/api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: randomUUID(), stream: true }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`)
  }
  const text = await r.text()
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue
    try {
      const parsed = JSON.parse(line.slice(6))
      if (parsed.event) onEvent(parsed.event)
    } catch { /* 忽略非 JSON 行 */ }
  }
}

/**
 * 发一条消息并汇总关键指标。
 *
 * @param port Agent Server 端口
 * @param extraParams 额外注入到 agent.start 的 params（用于测试字段是否生效）
 * @param prompt 用户消息
 * @param conversationId 可选，复用会话
 */
async function chat(port, extraParams, prompt, conversationId) {
  const result = {
    text: '',
    modelName: '',
    credit: '',
    contextWindow: 0,
    maxOutputTokens: 0,
    completionTokens: 0,
    durationMs: 0,
    eventTypes: [],
    reasoningSeen: false,
    error: null,
  }
  try {
    await rpcStream(port, 'agent.start', {
      content: [{ type: 'text', text: prompt }],
      conversationId: conversationId ?? `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...extraParams,
    }, (event) => {
      const type = event.type ?? ''
      const d = event.data ?? {}
      result.eventTypes.push(type)
      if (/reason|think/i.test(type)) result.reasoningSeen = true
      if (type === 'model_chunk' && d.finished === false) result.text += d.content ?? ''
      if (type === 'model_chunk' && d.finished === true) {
        result.contextWindow = d.contextInfo?.contextWindowTokens ?? 0
        result.maxOutputTokens = d.contextInfo?.maxOutputTokens ?? 0
        result.completionTokens = d.contextInfo?.usage?.completionTokens ?? 0
      }
      if (type === 'model_end') result.modelName = d.message?.modelDisplayName ?? ''
      if (type === 'agent_end') {
        result.credit = d.roundInfo?.creditCost ?? ''
        result.durationMs = d.roundDurationMs ?? 0
      }
    })
  } catch (error) {
    result.error = String(error?.message ?? error)
  }
  return result
}

/** 核对免费与模型名；不满足则记一次失败。 */
function assertFree(r, label) {
  const modelOk = r.modelName === FREE_MODEL
  const costOk = r.credit === FREE_COST
  const ok = modelOk && costOk
  if (!ok) failures++
  const mark = ok ? '✅' : '❌'
  process.stdout.write(
    `  ${mark} [${label}] model=${r.modelName || '(空)'} credit=${r.credit || '(空)'}`
    + `${modelOk ? '' : ' ← 模型不是 LongCat-2.5'}`
    + `${costOk ? '' : ' ← 扣费不为 0'}\n`,
  )
  return ok
}

// ─────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────

const port = await findServer()
if (port === null) {
  process.stderr.write('CatPaw Agent Server 未运行（请先启动妙手客户端）\n')
  process.exit(2)
}
process.stdout.write(`发现 Agent Server: 127.0.0.1:${port}\n`)

// ── 0. 健康检查 ──
section('0. 健康检查')
const ping = await rpc(port, 'ping')
process.stdout.write(`  ping → ${JSON.stringify(ping)}\n`)

// ── §5.1 模型列表动态性 ──
section('§5.1 模型列表：能否动态获取')
const snapshots = []
for (let i = 0; i < 3; i++) {
  const m = await rpc(port, 'agent.getAvailableModels')
  snapshots.push(JSON.stringify(m.result))
  process.stdout.write(`  第 ${i + 1} 次: ${JSON.stringify(m.result)}\n`)
  if (i < 2) await new Promise(r => setTimeout(r, 3000))
}
const stableAcrossCalls = snapshots.every(s => s === snapshots[0])
process.stdout.write(`\n  三次调用结果一致: ${stableAcrossCalls}\n`)
process.stdout.write(`  条目数: ${Array.isArray(JSON.parse(snapshots[0])) ? JSON.parse(snapshots[0]).length : 'n/a'}\n`)

// 试探是否有参数能拿更完整的清单
process.stdout.write('\n  试探参数能否拿到更完整清单:\n')
for (const params of [{ includeAll: true }, { type: 'all' }, { all: true }]) {
  const m = await rpc(port, 'agent.getAvailableModels', params)
  const s = JSON.stringify(m.result)
  const same = s === snapshots[0]
  process.stdout.write(`    ${JSON.stringify(params)} → ${same ? '无变化' : '有变化: ' + s.slice(0, 150)}\n`)
}

// ── §5.3 上下文档位注入（先跑，因为要用基线）──
section('§5.3 上下文档位：能否注入')
process.stdout.write('  基线（不注入）:\n')
const base = await chat(port, {}, 'hi')
assertFree(base, '基线')
process.stdout.write(
  `    contextWindow=${base.contextWindow} maxOutputTokens=${base.maxOutputTokens}`
  + ` completionTokens=${base.completionTokens} durationMs=${base.durationMs}\n`,
)
if (base.error) process.stdout.write(`    错误: ${base.error}\n`)

const tierCandidates = [
  ['params.contextWindow=50000', { contextWindow: 50000 }],
  ['params.contextWindowTokens=50000', { contextWindowTokens: 50000 }],
  ['params.maxTokens=1000', { maxTokens: 1000 }],
  ['params.maxOutputTokens=1000', { maxOutputTokens: 1000 }],
  ['params.config.contextWindow=50000', { config: { contextWindow: 50000 } }],
  ['params.config.maxTokens=1000', { config: { maxTokens: 1000 } }],
]
const tierResults = []
for (const [label, extra] of tierCandidates) {
  const r = await chat(port, extra, 'hi')
  const changed = r.contextWindow !== base.contextWindow || r.maxOutputTokens !== base.maxOutputTokens
  tierResults.push({ label, changed, contextWindow: r.contextWindow, maxOutputTokens: r.maxOutputTokens, error: r.error })
  process.stdout.write(
    `  ${label}: contextWindow=${r.contextWindow} maxOutputTokens=${r.maxOutputTokens}`
    + ` ${changed ? '✅ 字段生效' : '（未变）'}${r.error ? ' 错误=' + r.error.slice(0, 80) : ''}\n`,
  )
  assertFree(r, label)
}

// ── §5.4 深度思考 ──
section('§5.4 深度思考：设置是否生效')
process.stdout.write(
  `  基线: completionTokens=${base.completionTokens} durationMs=${base.durationMs}`
  + ` reasoningEvent=${base.reasoningSeen}\n`,
)
const thinkCandidates = [
  ['params.thinking={type:enabled}', { thinking: { type: 'enabled' } }],
  ['params.enableThinking=true', { enableThinking: true }],
  ['params.config.thinking={type:enabled}', { config: { thinking: { type: 'enabled' } } }],
  ['params.config.enableThinking=true', { config: { enableThinking: true } }],
  ['params.config.reasoning={effort:high}', { config: { reasoning: { effort: 'high' } } }],
]
const thinkResults = []
for (const [label, extra] of thinkCandidates) {
  const r = await chat(port, extra, 'Think carefully then answer: what is 2+2?')
  const tokenDelta = r.completionTokens - base.completionTokens
  const durationDelta = r.durationMs - base.durationMs
  const effective = r.reasoningSeen || tokenDelta > 20 || durationDelta > 3000
  thinkResults.push({ label, effective, tokenDelta, durationDelta, reasoningSeen: r.reasoningSeen, error: r.error })
  process.stdout.write(
    `  ${label}: completionTokens=${r.completionTokens}(Δ${tokenDelta})`
    + ` durationMs=${r.durationMs}(Δ${durationDelta}) reasoning=${r.reasoningSeen}`
    + ` ${effective ? '✅ 疑似生效' : '（未见效果）'}${r.error ? ' 错误=' + r.error.slice(0, 80) : ''}\n`,
  )
  assertFree(r, label)
}

// ── §5.5 其它必测项 ──
section('§5.5 其它必测项')

// 多轮对话
process.stdout.write('\n  多轮对话（复用 conversationId）:\n')
const convId = `probe-multi-${Date.now()}`
const r1 = await chat(port, {}, 'My name is Alice. Remember it.', convId)
assertFree(r1, '多轮-第1轮')
process.stdout.write(`    第1轮回复: ${r1.text.slice(0, 80)}\n`)
const r2 = await chat(port, {}, 'What is my name?', convId)
assertFree(r2, '多轮-第2轮')
const memoryOk = /alice/i.test(r2.text)
process.stdout.write(`    第2轮回复: ${r2.text.slice(0, 120)}\n`)
process.stdout.write(`    ${memoryOk ? '✅ 上下文保持（提到 Alice）' : '⚠️ 未见上下文保持'}\n`)

// 并发会话
process.stdout.write('\n  并发会话（同时 2 个）:\n')
const [cc1, cc2] = await Promise.all([
  chat(port, {}, 'Say: ONE'),
  chat(port, {}, 'Say: TWO'),
])
assertFree(cc1, '并发-1')
assertFree(cc2, '并发-2')
process.stdout.write(`    并发1: ${cc1.text.slice(0, 60)}${cc1.error ? ' 错误=' + cc1.error.slice(0, 60) : ''}\n`)
process.stdout.write(`    并发2: ${cc2.text.slice(0, 60)}${cc2.error ? ' 错误=' + cc2.error.slice(0, 60) : ''}\n`)

// 错误形态
process.stdout.write('\n  错误形态:\n')
try {
  const bad = await rpc(port, 'agent.start', { content: [], conversationId: '' })
  process.stdout.write(`    空参数(非流式) → ${JSON.stringify(bad).slice(0, 200)}\n`)
} catch (e) {
  process.stdout.write(`    空参数抛错: ${String(e?.message ?? e).slice(0, 120)}\n`)
}

// 工具调用探测
process.stdout.write('\n  工具调用（发一个需要工具的消息）:\n')
const toolTest = await chat(port, {}, 'List files in current directory using a tool if available.')
assertFree(toolTest, '工具')
process.stdout.write(`    事件类型: ${toolTest.eventTypes.join(' → ')}\n`)
process.stdout.write(`    回复前 120 字: ${toolTest.text.slice(0, 120)}\n`)

// ── 汇总 ──
section('汇总')
process.stdout.write(`模型列表稳定性: ${stableAcrossCalls ? '三次一致（可能是静态）' : '有变化（动态）'}\n`)
const anyTier = tierResults.some(r => r.changed)
process.stdout.write(`档位注入: ${anyTier ? '✅ 有字段生效' : '❌ 所有候选字段均未改变 contextWindow'}\n`)
const anyThink = thinkResults.some(r => r.effective)
process.stdout.write(`深度思考: ${anyThink ? '✅ 疑似生效' : '❌ 未见任何效果'}\n`)
process.stdout.write(`多轮上下文: ${memoryOk ? '✅ 保持' : '⚠️ 未见保持'}\n`)
process.stdout.write(`\n断言失败次数: ${failures}\n`)
process.exit(failures > 0 ? 1 : 0)
