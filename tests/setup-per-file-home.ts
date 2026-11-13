import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Every test FILE gets its own DSH_HOME.
 *
 * `setupFiles` run once per test file (in the file's own worker), so this is
 * process-env-wide for the file and needs no restore. A per-file home keeps
 * each file's configuration and local state isolated from every other file.
 */
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-connect-catpaw-file-'))
