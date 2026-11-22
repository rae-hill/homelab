import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { Config, Services } from "homelab-services"
import { createHash } from "node:crypto"
import { CachedResumeListingExtractionServiceLive } from "../src/layers/cached-resume-listing-extraction-service.js"
import { HashingServiceSha256Live } from "../src/layers/hashing-service-sha256.js"
import { makeListingCleanupCacheService } from "../src/layers/listing-cleanup-cache-service.js"
import { ResumePromptConfigServiceLive } from "../src/layers/resume-prompt-config-service.js"

/**
 * Counting OpenRouter stub — the whole point of the decorator is that the SECOND extract
 * of the same listing does NOT reach the provider.
 */
const makeCountingOpenRouter = () => {
  const calls: Array<string> = []
  const layer = Layer.succeed(Services.OpenRouterClientService.OpenRouterClientService, {
    chat: (req: any) =>
      Effect.as(
        Effect.sync(() => calls.push(req.model)),
        {
          content: JSON.stringify({
            cleanedListing: "Cleaned listing",
            jobTitle: "Senior Software Engineer",
            company: "Acme Corp",
          }),
          finishReason: "stop",
          usage: { promptTokens: 100, completionTokens: 50 },
        },
      ),
  })
  return { calls, layer }
}

const StubEnv = Layer.succeed(Config.Env.Env, {
  openRouterApiKeyFile: { _tag: "Some", value: "/fake/path" } as any,
  openRouterModel: "test-model",
  openRouterCleanupModel: "test-cleanup-model",
  openRouterCoverLetterModel: "test-cover-letter-model",
  openRouterBaseUrl: new URL("https://openrouter.ai/api/v1"),
  typstAssetsDir: Option.none(),
} as any)

const buildTestLayer = (
  openRouterLayer: Layer.Layer<Services.OpenRouterClientService.OpenRouterClientService>,
): Layer.Layer<Services.ResumeListingExtractionService.ResumeListingExtractionService> =>
  CachedResumeListingExtractionServiceLive.pipe(
    Layer.provide(openRouterLayer),
    Layer.provide(ResumePromptConfigServiceLive),
    Layer.provide(HashingServiceSha256Live),
    Layer.provide(makeListingCleanupCacheService()),
    Layer.provide(StubEnv),
  )

const runTest = <A, E>(
  f: (
    service: Services.ResumeListingExtractionService.ResumeListingExtractionServiceDef,
  ) => Effect.Effect<A, E>,
) =>
(
  layer: Layer.Layer<Services.ResumeListingExtractionService.ResumeListingExtractionService>,
): Effect.Effect<A, E> =>
  Effect.gen(function*() {
    const service = yield* Services.ResumeListingExtractionService.ResumeListingExtractionService
    return yield* f(service)
  }).pipe(Effect.provide(layer))

describe("cached resume listing extraction", () => {
  it.effect("first extract misses, second extract hits without a provider call", () => {
    const openRouter = makeCountingOpenRouter()
    return runTest((service) =>
      Effect.gen(function*() {
        const first = yield* service.extract({ listing: "Raw listing with cruft" })
        expect(first.fromCache).toBe(false)
        expect(first.cleanedListing).toBe("Cleaned listing")
        expect(openRouter.calls).toEqual(["test-cleanup-model"])

        const second = yield* service.extract({ listing: "Raw listing with cruft" })
        expect(second.fromCache).toBe(true)
        expect(second.cleanedListing).toBe("Cleaned listing")
        expect(second.jobTitle).toBe("Senior Software Engineer")
        expect(second.company).toBe("Acme Corp")
        // Stage meta on a hit reports the ORIGINAL call.
        expect(second.stage.promptTokens).toBe(100)
        // No second provider call — the cleanup spend was saved.
        expect(openRouter.calls).toEqual(["test-cleanup-model"])
      })
    )(buildTestLayer(openRouter.layer))
  })

  it.effect("different listings do not share cache entries", () => {
    const openRouter = makeCountingOpenRouter()
    return runTest((service) =>
      Effect.gen(function*() {
        const first = yield* service.extract({ listing: "Listing A" })
        const second = yield* service.extract({ listing: "Listing B" })
        expect(first.fromCache).toBe(false)
        expect(second.fromCache).toBe(false)
        expect(openRouter.calls).toEqual(["test-cleanup-model", "test-cleanup-model"])
      })
    )(buildTestLayer(openRouter.layer))
  })

  it.effect("propagates inner extraction failures without caching them", () => {
    const failing = Layer.succeed(Services.OpenRouterClientService.OpenRouterClientService, {
      chat: () =>
        Effect.fail(
          new Services.OpenRouterClientService.OpenRouterError({ message: "boom", error: null }),
        ),
    })
    return runTest((service) =>
      Effect.gen(function*() {
        const result = yield* Effect.flip(service.extract({ listing: "Raw listing" }))
        expect(result._tag).toBe("ListingExtractionError")
      })
    )(buildTestLayer(failing))
  })

  it.effect("cache key is sha256(listing):promptVersion:schemaVersion:cleanupModel", () => {
    const recordedKeys: Array<string> = []
    const spyCache = Layer.succeed(Services.ListingCleanupCacheService.ListingCleanupCacheService, {
      get: () => Effect.succeed(Option.none()),
      put: (key: string) => Effect.as(Effect.sync(() => void recordedKeys.push(key)), undefined),
    })
    const openRouter = makeCountingOpenRouter()

    const layer = CachedResumeListingExtractionServiceLive.pipe(
      Layer.provide(openRouter.layer),
      Layer.provide(ResumePromptConfigServiceLive),
      Layer.provide(HashingServiceSha256Live),
      Layer.provide(spyCache),
      Layer.provide(StubEnv),
    )

    return runTest((service) =>
      Effect.gen(function*() {
        yield* service.extract({ listing: "Raw listing" })
        const expectedHash = createHash("sha256").update("Raw listing", "utf8").digest("hex")
        expect(recordedKeys).toEqual([`${expectedHash}:v2-2026-11:v2:test-cleanup-model`])
      })
    )(layer)
  })
})
