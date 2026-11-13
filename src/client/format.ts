/**
 * 展示层数字格式化（纯函数，无 DOM / 无 React 依赖，可直接单测）。
 *
 * @module dsh-connect-catpaw/client/format
 */

/** 1M = 1048576（2^20），不是 10^6。 */
const TOKENS_PER_M = 1048576

/**
 * 把 token 数换算成 M 单位、保留 2 位小数。
 *
 * 用 2^20 而非 10^6：`contextWindow = 1048576` 正是 1×2^20，用 10^6 会显示成
 * `1.05M`，与官方文档写的 "1M" 对不上。
 *
 * @param n - token 数（可能来自上游，故接受 undefined / NaN）
 * @returns 形如 `1.00M` / `0.25M` 的字符串；非法或非正数返回 `—`
 */
export function formatTokens(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '—'
  return `${(n / TOKENS_PER_M).toFixed(2)}M`
}
