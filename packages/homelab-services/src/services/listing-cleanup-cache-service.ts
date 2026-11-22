import { Context, Effect, type Option } from "effect"

export const ListingCleanupCacheServiceId = "homelab-api/services/tailor/ListingCleanupCacheService"

/**
 * A cached stage-1 cleanup result — the `ExtractionResult` payload minus the per-call
 * `fromCache` flag (mirrors `ExtractionResult.stage` in resume-listing-extraction-service.ts
 * so a cache hit can rebuild the full result, stage meta included).
 */
export interface ListingCleanupCacheEntry {
  readonly cleanedListing: string
  readonly jobTitle: string
  readonly company: string | null
  readonly stage: {
    readonly model: string
    readonly promptTokens: number
    readonly completionTokens: number
    readonly latencyMs: number
  }
}

/**
 * In-process exact-hash cache for stage-1 listing-cleanup results, shared by the tailor and
 * cover-letter pipelines (docs/cover-letter-generator/01 §A — the LRU staging step of
 * resume-tailor-harness doc 06 §C; redis stays deferred until telemetry justifies it).
 *
 * Keys are composed by the extraction decorator: `sha256(hygienized listing) + promptVersion +
 * schemaVersion + cleanup model slug` — EXACT-hash only, never semantic matching (doc 06 §C
 * warning: a near-match silently returns a cleanup of a different listing).
 *
 * Infallible by contract: the impl is Ref-backed and cannot fail, so cache problems degrade to
 * "always miss" instead of failing a request.
 */
export interface ListingCleanupCacheServiceDef {
  /** Look up a cache entry; expired entries are pruned and reported as misses. */
  readonly get: (key: string) => Effect.Effect<Option.Option<ListingCleanupCacheEntry>>

  /** Store an entry, evicting the least-recently-used one when over capacity. */
  readonly put: (key: string, entry: ListingCleanupCacheEntry) => Effect.Effect<void>
}

export class ListingCleanupCacheService
  extends Context.Service<ListingCleanupCacheService, ListingCleanupCacheServiceDef>()(
    ListingCleanupCacheServiceId,
  )
{}

/** {@inheritDoc ListingCleanupCacheServiceDef.get} */
export const get = Effect.fn("ListingCleanupCacheService.get")(function*(
  ...params: Parameters<ListingCleanupCacheServiceDef["get"]>
): Effect.fn.Return<Option.Option<ListingCleanupCacheEntry>, never, ListingCleanupCacheService> {
  const svc = yield* ListingCleanupCacheService
  return yield* svc.get(...params)
})

/** {@inheritDoc ListingCleanupCacheServiceDef.put} */
export const put = Effect.fn("ListingCleanupCacheService.put")(function*(
  ...params: Parameters<ListingCleanupCacheServiceDef["put"]>
): Effect.fn.Return<void, never, ListingCleanupCacheService> {
  const svc = yield* ListingCleanupCacheService
  return yield* svc.put(...params)
})
