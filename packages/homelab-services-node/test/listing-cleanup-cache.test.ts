import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { Services } from "homelab-services"
import { makeListingCleanupCacheService } from "../src/layers/listing-cleanup-cache-service.js"

const entry = (cleanedListing: string): Services.ListingCleanupCacheService.ListingCleanupCacheEntry => ({
  cleanedListing,
  jobTitle: "Senior Software Engineer",
  company: "Acme Corp",
  stage: { model: "test-cleanup-model", promptTokens: 100, completionTokens: 50, latencyMs: 1234 },
})

describe("listing cleanup cache", () => {
  it.effect("misses on unknown keys", () =>
    Effect.gen(function*() {
      const cache = yield* Services.ListingCleanupCacheService.ListingCleanupCacheService
      const result = yield* cache.get("nope")
      expect(Option.isNone(result)).toBe(true)
    }).pipe(Effect.provide(Layer.merge(makeListingCleanupCacheService(), TestClock.layer()))))

  it.effect("round-trips an entry", () =>
    Effect.gen(function*() {
      const cache = yield* Services.ListingCleanupCacheService.ListingCleanupCacheService
      yield* cache.put("k1", entry("cleaned"))
      const result = yield* cache.get("k1")
      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value.cleanedListing).toBe("cleaned")
        expect(result.value.jobTitle).toBe("Senior Software Engineer")
        expect(result.value.company).toBe("Acme Corp")
        expect(result.value.stage.promptTokens).toBe(100)
      }
    }).pipe(Effect.provide(Layer.merge(makeListingCleanupCacheService(), TestClock.layer()))))

  it.effect("expires entries after the TTL", () =>
    Effect.gen(function*() {
      const cache = yield* Services.ListingCleanupCacheService.ListingCleanupCacheService
      yield* cache.put("k1", entry("cleaned"))
      expect(Option.isSome(yield* cache.get("k1"))).toBe(true)

      // Just under the default 72h TTL: still a hit.
      yield* TestClock.adjust(Duration.hours(71))
      expect(Option.isSome(yield* cache.get("k1"))).toBe(true)

      // Past the TTL: miss.
      yield* TestClock.adjust(Duration.hours(2))
      expect(Option.isNone(yield* cache.get("k1"))).toBe(true)
    }).pipe(Effect.provide(Layer.merge(makeListingCleanupCacheService(), TestClock.layer()))))

  it.effect("honors a custom TTL", () =>
    Effect.gen(function*() {
      const cache = yield* Services.ListingCleanupCacheService.ListingCleanupCacheService
      yield* cache.put("k1", entry("cleaned"))
      yield* TestClock.adjust(Duration.minutes(6))
      expect(Option.isNone(yield* cache.get("k1"))).toBe(true)
    }).pipe(
      Effect.provide(Layer.merge(makeListingCleanupCacheService({ ttlMillis: 300_000 }), TestClock.layer())),
    ))

  it.effect("evicts the least-recently-used entry over capacity", () =>
    Effect.gen(function*() {
      const cache = yield* Services.ListingCleanupCacheService.ListingCleanupCacheService
      yield* cache.put("a", entry("a"))
      yield* TestClock.adjust(Duration.seconds(1))
      yield* cache.put("b", entry("b"))

      // Touch "a" so "b" becomes the LRU victim.
      yield* TestClock.adjust(Duration.seconds(1))
      expect(Option.isSome(yield* cache.get("a"))).toBe(true)

      yield* TestClock.adjust(Duration.seconds(1))
      yield* cache.put("c", entry("c"))

      expect(Option.isSome(yield* cache.get("a"))).toBe(true)
      expect(Option.isNone(yield* cache.get("b"))).toBe(true)
      expect(Option.isSome(yield* cache.get("c"))).toBe(true)
    }).pipe(
      Effect.provide(Layer.merge(makeListingCleanupCacheService({ maxEntries: 2 }), TestClock.layer())),
    ))

  it.effect("overwriting an existing key does not grow the store", () =>
    Effect.gen(function*() {
      const cache = yield* Services.ListingCleanupCacheService.ListingCleanupCacheService
      yield* cache.put("a", entry("first"))
      yield* cache.put("b", entry("b"))
      yield* cache.put("a", entry("second"))
      const result = yield* cache.get("a")
      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value.cleanedListing).toBe("second")
      }
      expect(Option.isSome(yield* cache.get("b"))).toBe(true)
    }).pipe(
      Effect.provide(Layer.merge(makeListingCleanupCacheService({ maxEntries: 2 }), TestClock.layer())),
    ))
})
