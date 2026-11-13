#!/usr/bin/env node
/**
 * Read-only probe for channel A (LongCat official API).
 *
 * Modeled on dsh-connect-qoder's scripts/probe-cosy.mjs: verify the upstream
 * contract without starting the host. Independent rewrite, no source copied.
 *
 * Run (from the repository root):
 *   LONGCAT_API_KEY=<key> node --experimental-strip-types scripts/probe-longcat.mjs
 *
 * The key is read from the environment only, is never written to disk, and is
 * never printed. Output is limited to field names, lengths and shapes; no full
 * response body and no credentials are emitted. No chat request is sent and
 * there is no account-figure step.
 */

const KEY = process.env.LONGCAT_API_KEY

if (!KEY) {
  process.stderr.write('missing LONGCAT_API_KEY\n')
  process.exit(2)
}

/** Scrub the exact key and anything credential-shaped before it reaches stdout. */
function redact(text) {
  let out = String(text)
  if (out.includes(KEY)) {
    out = out.split(KEY).join('[redacted]')
  }
  return out.replace(/\b(?:sk|pt|lc)-[A-Za-z0-9_-]{6,}\b/giu, '[redacted]')
}

async function step(label, fn) {
  process.stdout.write(`\n== ${label} ==\n`)
  try {
    const out = await fn()
    process.stdout.write(`${redact(typeof out === 'string' ? out : JSON.stringify(out, null, 2))}\n`)
    return true
  } catch (error) {
    process.stdout.write(`FAILED: ${redact(error?.message ?? error)}\n`)
    return false
  }
}

// Load the TypeScript module at runtime via Node's type stripping; no tsx/ts-node.
const { createLongcatClient } = await import('../src/longcat.ts')
const client = createLongcatClient({ apiKey: KEY })

let ok = true

ok = (await step('1. models', async () => {
  const models = await client.listModels()
  return {
    count: models.length,
    idLengths: models.map((m) => m.id.length),
    fieldNames: models.map((m) => Object.keys(m).sort()),
    detailSources: models.map((m) => m.detailSource ?? null),
  }
})) && ok

ok = (await step('2. detail', async () => {
  const detail = await client.getModelDetail('LongCat-2.5')
  return {
    isNull: detail === null,
    fieldNames: detail ? Object.keys(detail).sort() : [],
    contextLengthType: detail ? typeof detail.context_length : 'n/a',
    supportedParametersCount: detail && Array.isArray(detail.supported_parameters)
      ? detail.supported_parameters.length
      : 0,
    pricingFieldNames: detail && detail.pricing ? Object.keys(detail.pricing) : [],
  }
})) && ok

ok = (await step('3. thinking shape', async () => ({
  field: 'thinking',
  shape: { type: 'enabled | disabled' },
  binary: true,
  chatSent: false,
}))) && ok

process.exit(ok ? 0 : 1)
