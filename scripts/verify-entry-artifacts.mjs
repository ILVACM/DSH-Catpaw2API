#!/usr/bin/env node
/**
 * Verify that the browser half was built with the shell's module-loader
 * wrapper. tsdown emits lib/client.js with a banner/footer/intro; if that
 * wrapper is missing, the client half can never activate in the web UI.
 *
 * Read-only. Intended to run right after `tsdown` (see package.json build).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const client = resolve(ROOT, 'lib', 'client.js')

if (!existsSync(client)) {
  process.stderr.write(`verify-entry-artifacts: missing ${client}\n`)
  process.exit(1)
}
const text = readFileSync(client, 'utf8')
// tsdown emits the footer across several lines, so check the wrapper pieces
// independently rather than one exact line. The intro defines `module`, the
// banner opens the loader, and the footer returns `module.exports` then closes.
const mustContain = [
  ['module-loader banner', 'window.__ModuleLoader__.load('],
  ['plugin id', 'id: "dsh-connect-catpaw"'],
  ['factory return', 'return module.exports;'],
  ['loader close', '} });'],
  ['cjs intro', 'var module = { exports: {} };'],
]
const missing = mustContain.filter(([, s]) => !text.includes(s)).map(([name]) => name)
if (missing.length) {
  process.stderr.write(`verify-entry-artifacts: lib/client.js is missing: ${missing.join(' | ')}\n`)
  process.exit(1)
}
process.stdout.write('verify-entry-artifacts: lib/client.js wrapper ok.\n')
