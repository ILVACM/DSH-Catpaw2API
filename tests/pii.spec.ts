import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GATE = resolve(ROOT, 'scripts', 'check-pii.mjs')

/**
 * Reuse the repository privacy gate as a subprocess and require a clean exit.
 * Comments in this guard deliberately carry no sample values — the gate scans
 * this file too, so an illustrative literal here would be self-defeating.
 */
describe('privacy gate', () => {
  it('scripts/check-pii.mjs exits 0', () => {
    const result = spawnSync(process.execPath, [GATE], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
  })
})
