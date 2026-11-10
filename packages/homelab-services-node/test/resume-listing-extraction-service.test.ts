import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Config, Services } from "homelab-services"
import { ResumeListingExtractionServiceLive } from "../src/layers/resume-listing-extraction-service.js"
import { ResumePromptConfigServiceLive } from "../src/layers/resume-prompt-config-service.js"

const StubOpenRouterClient = Layer.succeed(Services.OpenRouterClientService.OpenRouterClientService, {
  chat: (req: any) =>
    Effect.gen(function*() {
      // Stage 1 (cleanup) call - check by model name
      if (req.model === "test-cleanup-model") {
        return {
          content: JSON.stringify({
            cleanedListing: "Cleaned job listing for Senior Software Engineer",
            jobTitle: "Senior Software Engineer",
            company: "Acme Corp",
          }),
          finishReason: "stop",
          usage: { promptTokens: 100, completionTokens: 50 },
        }
      }
      return yield* Effect.fail(
        new Services.OpenRouterClientService.OpenRouterError({
          message: "Unexpected model",
          error: null,
        }),
      )
    }),
})

const StubEnv = Layer.succeed(Config.Env.Env, {
  openRouterApiKeyFile: { _tag: "Some", value: "/fake/path" } as any,
  openRouterModel: "test-model",
  openRouterCleanupModel: "test-cleanup-model",
  openRouterBaseUrl: new URL("https://openrouter.ai/api/v1"),
} as any)

describe("resume listing extraction service", () => {
  const TestLayer = ResumeListingExtractionServiceLive.pipe(
    Layer.provide(ResumePromptConfigServiceLive),
    Layer.provide(StubOpenRouterClient),
    Layer.provide(StubEnv),
  )

  const runTest = <E, A>(
    effect: Effect.Effect<A, E, Services.ResumeListingExtractionService.ResumeListingExtractionService>,
  ) => effect.pipe(Effect.provide(TestLayer))

  it.effect("successfully extracts cleaned listing and metadata", () =>
    runTest(Effect.gen(function*() {
      const service = yield* Services.ResumeListingExtractionService.ResumeListingExtractionService
      const result = yield* service.extract({
        listing: "Raw job listing with cruft",
      })

      expect(result.cleanedListing).toBe("Cleaned job listing for Senior Software Engineer")
      expect(result.jobTitle).toBe("Senior Software Engineer")
      expect(result.company).toBe("Acme Corp")
      expect(result.stage.model).toBe("test-cleanup-model")
      expect(result.stage.promptTokens).toBe(100)
      expect(result.stage.completionTokens).toBe(50)
      expect(result.stage.latencyMs).toBeGreaterThanOrEqual(0)
    })))

  it.effect("handles invalid JSON response as ListingExtractionError", () => {
    // Create a stub that returns invalid JSON
    const BadJsonClient = Layer.succeed(Services.OpenRouterClientService.OpenRouterClientService, {
      chat: (_req: any) =>
        Effect.succeed({
          content: "not valid json",
          finishReason: "stop",
          usage: { promptTokens: 100, completionTokens: 50 },
        }),
    })

    const BadLayer = ResumeListingExtractionServiceLive.pipe(
      Layer.provide(ResumePromptConfigServiceLive),
      Layer.provide(BadJsonClient),
      Layer.provide(StubEnv),
    )

    // The service instance MUST come from BadLayer — its client is captured at layer build
    return Effect.gen(function*() {
      const service = yield* Services.ResumeListingExtractionService.ResumeListingExtractionService
      const result = yield* service.extract({ listing: "Test listing" }).pipe(Effect.flip)

      expect(result._tag).toBe("ListingExtractionError")
      if (result._tag === "ListingExtractionError") {
        expect(result.message).toContain("Stage 1 (cleanup) output was not valid JSON")
      }
    }).pipe(Effect.provide(BadLayer))
  })

  it.effect("propagates OpenRouter errors as ListingExtractionError", () => {
    // Create a stub that fails
    const FailingClient = Layer.succeed(Services.OpenRouterClientService.OpenRouterClientService, {
      chat: (_req: any) =>
        Effect.fail(
          new Services.OpenRouterClientService.OpenRouterError({
            message: "Network error",
            error: null,
          }),
        ),
    })

    const FailLayer = ResumeListingExtractionServiceLive.pipe(
      Layer.provide(ResumePromptConfigServiceLive),
      Layer.provide(FailingClient),
      Layer.provide(StubEnv),
    )

    return Effect.gen(function*() {
      const service = yield* Services.ResumeListingExtractionService.ResumeListingExtractionService
      const result = yield* service.extract({ listing: "Test listing" }).pipe(Effect.flip)

      expect(result._tag).toBe("ListingExtractionError")
      if (result._tag === "ListingExtractionError") {
        expect(result.message).toContain("Stage 1 (cleanup) failed")
      }
    }).pipe(Effect.provide(FailLayer))
  })
})
