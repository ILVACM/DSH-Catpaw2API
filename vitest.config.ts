import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Tests must never touch the real DSH home: the plugin writes configuration
 * under `$DSH_HOME`, and polluting a developer's real profile (or being blocked
 * by the sandbox) would make results meaningless.
 */
const isolatedHome = mkdtempSync(join(tmpdir(), 'dsh-connect-catpaw-test-'))

/**
 * Point the home-derived paths at an empty temp directory too, so the ambient
 * answer is "no local credentials" on every platform. `HOME` and `USERPROFILE`
 * cover os.homedir() (POSIX vs Windows); `LOCALAPPDATA` / `APPDATA` cover the
 * Windows branch; `XDG_CONFIG_HOME` covers the Linux branch.
 */
const isolatedEnv = {
  DSH_HOME: isolatedHome,
  HOME: isolatedHome,
  USERPROFILE: isolatedHome,
  LOCALAPPDATA: join(isolatedHome, 'AppData', 'Local'),
  APPDATA: join(isolatedHome, 'AppData', 'Roaming'),
  XDG_CONFIG_HOME: join(isolatedHome, '.config'),
}

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup-per-file-home.ts'],
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    environment: 'node',
    env: isolatedEnv,
    testTimeout: 30_000,
  },
})
