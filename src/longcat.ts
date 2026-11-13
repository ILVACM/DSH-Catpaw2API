/**
 * Channel A — LongCat official OpenAI-compatible API.
 *
 * Upstream shapes: docs/longcat.md §2 (model list) / §3 (model detail) /
 * §4 (chat completions + the binary thinking switch). This module reads only
 * the public model list and the public per-model detail endpoints.
 *
 * Privacy: the key is placed solely in the Authorization header of an outbound
 * request. It is never logged, never returned, and any error text is scrubbed
 * with [redacted] before it can leave this module (decision 1).
 */

import {
  LONGCAT_MODELS_URL,
  LONGCAT_MODEL_DETAIL_URL,
  LONGCAT_BASE_URL,
  LONGCAT_CATALOG_FALLBACK,
} from './routing.ts'
import type { CatalogEntry } from './contracts.ts'

/** Raw shape of GET /v1/models/{model} (docs/longcat.md §3). Internal only. */
interface ModelDetailRaw {
  id?: string
  name?: string
  created?: number
  context_length?: number
  architecture?: {
    input_modalities?: string[]
    output_modalities?: string[]
    modality?: string
    tokenizer?: string
    instruct_type?: string | null
  }
  supported_parameters?: string[]
  pricing?: { prompt: string; completion: string; cached_tokens: string }
}

interface LongcatClientOptions {
  apiKey?: string
  fetchFn?: typeof fetch
}

/** The whole documented static catalog, each row honestly marked as fallback. */
function fallbackCatalog(): CatalogEntry[] {
  return LONGCAT_CATALOG_FALLBACK.map((entry) => ({ ...entry, detailSource: 'fallback' as const }))
}

/**
 * Per-model fallback (decision 2 allows partial results). If the static catalog
 * has no row for this id, return the whole documented catalog instead of
 * inventing parameters for an unknown model.
 */
function fallbackForId(id: string): CatalogEntry[] {
  const prefixed = `longcat/${id}`
  const match = LONGCAT_CATALOG_FALLBACK.find((entry) => entry.id === prefixed)
  return match ? [{ ...match, detailSource: 'fallback' as const }] : fallbackCatalog()
}

export function createLongcatClient({ apiKey = '', fetchFn = fetch }: LongcatClientOptions = {}) {
  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  })

  /** Step 2 alone: GET /v1/models/{model}; 401/404/network failure → null, never throws. */
  async function getModelDetail(id: string): Promise<ModelDetailRaw | null> {
    try {
      const res = await fetchFn(LONGCAT_MODEL_DETAIL_URL + encodeURIComponent(id), {
        method: 'GET',
        headers: authHeaders(),
      })
      if (res.status === 401 || res.status === 404 || !res.ok) {
        return null
      }
      const payload = (await res.json()) as ModelDetailRaw | null
      return payload && typeof payload === 'object' ? payload : null
    } catch {
      return null
    }
  }

  /**
   * Two-step catalog composition (decision 2):
   *   1. GET /v1/models → id list (that response carries no parameter fields).
   *   2. For every id: getModelDetail(id) → context / params / pricing.
   * Any failure falls back to the static catalog, never masquerading as live.
   */
  async function listModels(): Promise<CatalogEntry[]> {
    let ids: string[]
    try {
      const res = await fetchFn(LONGCAT_MODELS_URL, { method: 'GET', headers: authHeaders() })
      if (res.status === 401 || !res.ok) {
        return fallbackCatalog()
      }
      const payload = (await res.json()) as {
        object?: string
        data?: Array<{ id?: string; object?: string; owned_by?: string }>
      } | null
      const rows = payload && Array.isArray(payload.data) ? payload.data : []
      ids = rows
        .map((row) => (typeof row?.id === 'string' ? row.id : ''))
        .filter((id): id is string => id.length > 0)
    } catch {
      return fallbackCatalog()
    }

    if (ids.length === 0) {
      return fallbackCatalog()
    }

    const entries: CatalogEntry[] = []
    for (const id of ids) {
      let detail: ModelDetailRaw | null
      try {
        detail = await getModelDetail(id)
      } catch {
        detail = null
      }
      // A missing / invalid context_length counts as a detail anomaly → fallback.
      if (!detail || typeof detail.context_length !== 'number') {
        entries.push(...fallbackForId(id))
        continue
      }
      const prefixed = `longcat/${id}`
      const staticRow = LONGCAT_CATALOG_FALLBACK.find((entry) => entry.id === prefixed)
      const entry: CatalogEntry = {
        id: prefixed,
        provider: 'longcat',
        name: detail.name || id,
        contextWindow: detail.context_length,
        // The two endpoints do not expose max output tokens; use the documented
        // static value for the same model id (decision 2).
        maxTokens: staticRow ? staticRow.maxTokens : 0,
        // Fixed per docs/longcat.md §3: do NOT derive this from
        // architecture.input_modalities (it wrongly reports ["text"]).
        input: ['text', 'image'],
        detailSource: 'live',
        // No contextTiers / contextTier here — F10 belongs to channel B only.
      }
      // Attach optional live fields only when present. Under
      // exactOptionalPropertyTypes we must not assign an explicit undefined.
      if (Array.isArray(detail.supported_parameters)) {
        entry.supportedParameters = detail.supported_parameters
      }
      if (detail.pricing) {
        entry.pricing = detail.pricing
      }
      entries.push(entry)
    }
    return entries
  }

  /**
   * POST /chat/completions. Injects the binary thinking switch (decision 3/F9);
   * every other field (including stream) is forwarded untouched (F3).
   */
  async function chat(
    body: Record<string, unknown>,
    signal?: AbortSignal,
    thinkEnabled: boolean = true,
  ): Promise<Response> {
    const payload: Record<string, unknown> = {
      ...body,
      thinking: { type: thinkEnabled ? 'enabled' : 'disabled' },
    }
    // Build RequestInit field-by-field: under exactOptionalPropertyTypes an
    // explicitly-undefined signal is not assignable, so attach it only when set.
    const init: RequestInit = {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    }
    if (signal) {
      init.signal = signal
    }
    try {
      return await fetchFn(LONGCAT_BASE_URL + '/chat/completions', init)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '')
      // Never let upstream error text carry the key back to the caller.
      if (apiKey && message.includes(apiKey)) {
        throw new Error(message.split(apiKey).join('[redacted]'))
      }
      throw error
    }
  }

  // Exactly three methods. There is no account-level reader here (decision 1).
  return { listModels, getModelDetail, chat }
}
