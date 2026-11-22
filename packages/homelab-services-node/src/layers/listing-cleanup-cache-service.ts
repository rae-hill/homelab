import { Clock, Effect, HashMap, Layer, Option, Ref } from "effect"
import { Services } from "homelab-services"

const HOUR_MILLIS = 3_600_000

/** Cache tuning knobs; overridable via `makeListingCleanupCacheService` (quota-service idiom). */
export interface ListingCleanupCacheOptions {
  readonly maxEntries?: number
  readonly ttlMillis?: number
}

/** Defaults: 100 entries, 72h TTL (doc 01 §A; prompt/model versions are part of the key anyway). */
export const defaultCacheOptions = { maxEntries: 100, ttlMillis: 72 * HOUR_MILLIS }

interface TimedEntry {
  readonly entry: Services.ListingCleanupCacheService.ListingCleanupCacheEntry
  readonly expiresAtMillis: number
  readonly lastUsedMillis: number
}

/**
 * Live implementation: Ref-backed LRU+TTL store, in-process only — restarts clear it
 * (doc 06 §C staging: redis only when telemetry shows restarts eating real spend).
 * Time comes from `Clock.currentTimeMillis` (TestClock-friendly, never `Date.now()` —
 * tailor-quota-service idiom).
 *
 * Infallible: every operation is a pure Ref modify, so the "cache problems degrade to
 * always-miss" contract is structural, not error handling.
 */
export const makeListingCleanupCacheService = (options: ListingCleanupCacheOptions = {}) => {
  const maxEntries = options.maxEntries ?? defaultCacheOptions.maxEntries
  const ttlMillis = options.ttlMillis ?? defaultCacheOptions.ttlMillis

  return Layer.effect(
    Services.ListingCleanupCacheService.ListingCleanupCacheService,
    Effect.gen(function*() {
      const ref = yield* Ref.make(HashMap.empty<string, TimedEntry>())

      // O(n) scan is fine at maxEntries=100 and keeps the store immutable.
      const evictLeastRecentlyUsed = (
        map: HashMap.HashMap<string, TimedEntry>,
      ): HashMap.HashMap<string, TimedEntry> => {
        let oldestKey: string | undefined
        let oldestUsed = Number.POSITIVE_INFINITY
        for (const [key, value] of HashMap.entries(map)) {
          if (value.lastUsedMillis < oldestUsed) {
            oldestUsed = value.lastUsedMillis
            oldestKey = key
          }
        }
        return oldestKey === undefined ? map : HashMap.remove(map, oldestKey)
      }

      return {
        get: Effect.fn("ListingCleanupCacheService.get")(function*(key: string) {
          const now = yield* Clock.currentTimeMillis
          return yield* Ref.modify(ref, (map) => {
            const found = HashMap.get(map, key)
            if (Option.isSome(found)) {
              if (found.value.expiresAtMillis > now) {
                // Touch for LRU ordering; return the stored entry.
                const touched: TimedEntry = { ...found.value, lastUsedMillis: now }
                return [Option.some(found.value.entry), HashMap.set(map, key, touched)] as const
              }
              // Expired — prune so capacity is reclaimed eagerly.
              return [Option.none(), HashMap.remove(map, key)] as const
            }
            return [Option.none(), map] as const
          })
        }),

        put: Effect.fn("ListingCleanupCacheService.put")(function*(
          key: string,
          entry: Services.ListingCleanupCacheService.ListingCleanupCacheEntry,
        ) {
          const now = yield* Clock.currentTimeMillis
          yield* Ref.update(ref, (map) => {
            let next = HashMap.set(map, key, {
              entry,
              expiresAtMillis: now + ttlMillis,
              lastUsedMillis: now,
            })
            while (HashMap.size(next) > maxEntries) {
              next = evictLeastRecentlyUsed(next)
            }
            return next
          })
        }),
      } satisfies Services.ListingCleanupCacheService.ListingCleanupCacheServiceDef
    }),
  )
}

export const ListingCleanupCacheServiceLive = makeListingCleanupCacheService()
