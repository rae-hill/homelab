import { Effect, Layer, Option } from "effect"
import { Config, Services, Utils } from "homelab-services"
import { makeResumeListingExtractionServiceImpl } from "./resume-listing-extraction-service.js"

/**
 * Cache decorator over stage-1 listing cleanup (docs/cover-letter-generator/01 §A).
 *
 * Presents the SAME `ResumeListingExtractionService` tag, so orchestrators (TailorService,
 * CoverLetterService) cannot tell the difference — the only observable change is
 * `fromCache: true` on a hit (which TailorService maps into `TailorMeta.cacheHit`).
 *
 * Key scheme (EXACT-hash only — doc 06 §C warning, never semantic matching):
 *   sha256(hygienizedListing) : promptVersion : schemaVersion : cleanupModelSlug
 * The listing arrives already hygienized by the orchestrator, so hashing the argument is
 * stable across the tailor and cover-letter flows — the tailor→letter workflow makes hits
 * structural, saving the second OpenRouter cleanup call.
 *
 * `ListingCleanupCacheService` comes from RIn (NOT provided internally) so the tailor and
 * cover-letter shell aggregates share ONE cache instance via a single memoized provide in
 * main.ts (CL-D6).
 */

/** Dependencies of the decorator; the inner raw impl is built from the same resolved deps. */
export interface CachedResumeListingExtractionDeps {
  readonly cache: Services.ListingCleanupCacheService.ListingCleanupCacheServiceDef
  readonly hashing: Services.HashingServiceSha256.HashingServiceSha256Def
  readonly promptConfig: Services.ResumePromptConfigService.ResumePromptConfigServiceDef
  readonly env: typeof Config.Env.Env.Service
  readonly inner: Services.ResumeListingExtractionService.ResumeListingExtractionServiceDef
}

class CachedResumeListingExtractionServiceImpl
  implements Services.ResumeListingExtractionService.ResumeListingExtractionServiceDef
{
  constructor(private readonly deps: CachedResumeListingExtractionDeps) {}

  extract(args: { listing: string }): Effect.Effect<
    Services.ResumeListingExtractionService.ExtractionResult,
    Services.ResumeListingExtractionService.ListingExtractionError
  > {
    return Effect.gen({ self: this }, function*() {
      const listingHash = yield* this.deps.hashing.digestHex(args.listing)
      const key = [
        listingHash,
        this.deps.promptConfig.version,
        this.deps.promptConfig.schemaVersion,
        this.deps.env.openRouterCleanupModel,
      ].join(":")

      const cached = yield* this.deps.cache.get(key)
      if (Option.isSome(cached)) {
        yield* Effect.logInfo("Stage 1 (cleanup) cache hit", {
          listingHash,
          model: cached.value.stage.model,
        })
        const { cleanedListing, company, jobTitle, stage } = cached.value
        return { cleanedListing, company, jobTitle, stage, fromCache: true }
      }

      const fresh = yield* this.deps.inner.extract(args)
      const { fromCache: _fromCache, ...cacheable } = fresh
      yield* this.deps.cache.put(key, cacheable)
      return fresh
    }).pipe(
      // The decorator adds one failure source (key hashing); keep the Def's error
      // channel exact by wrapping it into ListingExtractionError (T12 semantics).
      Effect.mapError((error) =>
        error instanceof Services.ResumeListingExtractionService.ListingExtractionError
          ? error
          : new Services.ResumeListingExtractionService.ListingExtractionError({
            message: "Stage 1 (cleanup) cache-key hashing failed",
            error: Utils.errorToJson(error),
          })
      ),
    )
  }
}

export const makeCachedResumeListingExtractionService = () =>
  Layer.effect(
    Services.ResumeListingExtractionService.ResumeListingExtractionService,
    Effect.gen(function*() {
      const cache = yield* Services.ListingCleanupCacheService.ListingCleanupCacheService
      const hashing = yield* Services.HashingServiceSha256.HashingServiceSha256
      const openRouterClient = yield* Services.OpenRouterClientService.OpenRouterClientService
      const promptConfig = yield* Services.ResumePromptConfigService.ResumePromptConfigService
      const env = yield* Config.Env.Env

      const inner = makeResumeListingExtractionServiceImpl({ openRouterClient, promptConfig, env })
      return new CachedResumeListingExtractionServiceImpl({
        cache,
        hashing,
        promptConfig,
        env,
        inner,
      })
    }),
  )

/**
 * Live decorator layer. RIn: ListingCleanupCacheService + HashingServiceSha256 +
 * OpenRouterClientService + ResumePromptConfigService + Config.Env.
 */
export const CachedResumeListingExtractionServiceLive = makeCachedResumeListingExtractionService()
