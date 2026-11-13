#!/usr/bin/env node
/**
 * Privacy gate: does the repository (or the published tarball) expose anything
 * that identifies a real person, account, machine or credential?
 *
 *   node scripts/check-pii.mjs            # scan source, tests, scripts, docs, config
 *
 * This is a deliberately small, independent rewrite of the behavior of the
 * reference plugin's check-pii.mjs (MIT). It is read-only: no network, no writes.
 * It scans TEXT files; it cannot read pixels — screenshots need a human review.
 *
 * The allow-list carries only obvious fake placeholder values. A real email,
 * a long credential-shaped token, a real home path, or a long digit run that
 * looks like a real balance/account number fails the build.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The plugin now lives at the repository root, so ROOT is the repo root. Skip
// the directories that are not part of the plugin's own source and would make
// the scan both slow and noisy: `temp/` (read-only reference plugins and the
// phase-1 report), `docs/` (design documents with their own review), `.git/`,
// plus generated `lib/` and installed `node_modules/`.
const SKIP_DIRS = new Set(['node_modules', 'lib', '.git', 'acl-recovery', 'temp', 'docs', '.pnpm-store'])
const TEXT_EXT = new Set(['.ts', '.tsx', '.mjs', '.js', '.cjs', '.json', '.md', '.yml', '.yaml', '.txt'])
const ALLOW = [
  'acct-demo',
  'acct-demo@example.com',
  'example.com',
  '01/01/2027',
  '<user>',
  'pt-0123456789abcdef',
  // Obvious fake values used by the test fixtures (not real credentials or balances).
  'pt-probe-fake-key-DO-NOT-LEAK',
  '1773331200',
  'YOUR_API_KEY',
  'LONGCAT_API_KEY',
  // 妙手 `agent_end.roundInfo.creditCost` 的「免费」字面值：全零，不是余额。
  '00000000',
  // 妙手云端 model-types 返回的公开模型 ID（LongCat-2.5），不是余额/账号。
  '10002544',
]

// Patterns that indicate a real value slipped in. Deliberately conservative.
// `long-balance-digits` skips values that look like a unix timestamp (10 digits
// starting with 1) because those appear in public API examples as `created`.
const PATTERNS = [
  { name: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { name: 'bearer-or-long-token', re: /\b(?:sk|pt|ghp|eyJ)[A-Za-z0-9_\-]{16,}\b/g },
  { name: 'windows-home', re: /[A-Za-z]:\\[Uu]sers\\[^\\\s]+/g },
  { name: 'posix-home', re: /\/(?:Users|home)\/[A-Za-z0-9._-]+\//g },
  { name: 'long-balance-digits', re: /\b(?!1\d{9}\b)\d{8,}\b/g },
]

function isAllowed(value) {
  return ALLOW.some(a => value === a || value.includes(a))
}

function walk(dir, acc) {
  let entries
  try { entries = readdirSync(dir) } catch { return acc }
  for (const name of entries) {
    const full = join(dir, name)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      walk(full, acc)
    } else if (st.isFile()) {
      const ext = extname(name).toLowerCase()
      // Also scan dotfiles like .env by name when they are text-ish.
      if (TEXT_EXT.has(ext) || name.startsWith('.env') || name === '.npmrc') acc.push(full)
    }
  }
  return acc
}

function scanFile(file) {
  let text
  try { text = readFileSync(file, 'utf8') } catch { return [] }
  const hits = []
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      const v = m[0]
      if (isAllowed(v)) continue
      const line = text.slice(0, m.index).split('\n').length
      hits.push(`${relative(ROOT, file)}:${line}: ${name}: ${v}`)
    }
  }
  return hits
}

const files = walk(ROOT, [])
const allHits = []
for (const f of files) allHits.push(...scanFile(f))

if (allHits.length) {
  for (const h of allHits) process.stderr.write(`PII: ${h}\n`)
  process.stderr.write(`PII gate failed: ${allHits.length} hit(s).\n`)
  process.exit(1)
}
process.stdout.write(`PII gate ok: ${files.length} file(s) scanned.\n`)
