import { describe, expect, it } from "@effect/vitest"
import { Cause, Effect, Layer } from "effect"
import { Config, Services } from "homelab-services"
import { ResumeContent } from "shared"
import { TailorServiceLive } from "../src/layers/tailor-service.js"

// Stub OpenRouterClientService that returns canned responses
const makeStubOpenRouterClient = (
  stage1Response?: string,
  stage2Response?: string,
  shouldFailStage1 = false,
  shouldFailStage2 = false,
) =>
  Layer.succeed(Services.OpenRouterClientService.OpenRouterClientService, {
    chat: (req: any) =>
      Effect.gen(function*() {
        // Stage 1 (cleanup) call
        if (req.maxTokens === 4000) {
          if (shouldFailStage1) {
            return yield* Effect.fail(
              new Services.OpenRouterClientService.OpenRouterError({
                message: "Stage 1 failed",
                error: null,
              }),
            )
          }
          return {
            content: stage1Response ??
              JSON.stringify({
                cleanedListing: "Cleaned job listing for Senior Software Engineer",
                jobTitle: "Senior Software Engineer",
                company: "Acme Corp",
              }),
            finishReason: "stop",
            usage: { promptTokens: 100, completionTokens: 50 },
          }
        } // Stage 2 (tailor) call
        else {
          if (shouldFailStage2) {
            return yield* Effect.fail(
              new Services.OpenRouterClientService.OpenRouterError({
                message: "Stage 2 failed",
                error: null,
              }),
            )
          }
          return {
            content: stage2Response ??
              JSON.stringify({
                headline: "Experienced Software Engineer with TypeScript expertise",
                summary: "Senior engineer with 5+ years of TypeScript and React experience",
                bullets: [],
                entryDescriptions: [],
                hiddenBullets: [],
                tagGroups: [],
                fit: {
                  verdict: "strong",
                  summary: "Strong match for the role",
                  tips: [],
                  keywordCoverage: {
                    required: ["TypeScript", "React"],
                  },
                },
              }),
            finishReason: "stop",
            usage: { promptTokens: 200, completionTokens: 150 },
          }
        }
      }),
  })

// Stub TailorQuotaService that always succeeds
const StubQuotaService = Layer.succeed(Services.TailorQuotaService.TailorQuotaService, {
  tryConsume: () => Effect.void,
})

// Stub TailorQuotaService that always fails
const ExhaustedQuotaService = Layer.succeed(Services.TailorQuotaService.TailorQuotaService, {
  tryConsume: () =>
    Effect.fail(
      new Services.TailorService.TailorQuotaExceeded({
        retryAfterSeconds: 3600,
      }),
    ),
})

// Stub env for testing
const StubEnv = Layer.succeed(Config.Env.Env, {
  openRouterApiKeyFile: { _tag: "Some", value: "/fake/path" } as any,
  openRouterModel: "test-model",
  openRouterCleanupModel: "test-cleanup-model",
  openRouterBaseUrl: new URL("https://openrouter.ai/api/v1"),
} as any)

describe("tailor pipeline", () => {
  const TestLayer = TailorServiceLive.pipe(
    Layer.provide(StubEnv),
  )

  it.effect("happy path returns tailored content with full metadata", () =>
    Effect.gen(function*() {
      const service = yield* Services.TailorService.TailorService
      const content = ResumeContent.INITIAL_CONTENT_STATE

      const result = yield* service.tailorResume(
        "user@example.com",
        "Senior Software Engineer role requiring TypeScript and React",
        content,
        "v1",
      )

      // Should return success with all fields
      expect(result.jobTitle).toBe("Senior Software Engineer")
      expect(result.company).toBe("Acme Corp")
      expect(result.content).toBeDefined()
      expect(result.baseVersion).toBe("v1")
      expect(result.fit).toBeDefined()
      expect(result.fit.verdict).toBe("strong")
      expect(result.meta).toBeDefined()
      expect(result.meta.stage1).toBeDefined()
      expect(result.meta.stage2).toBeDefined()
      expect(result.meta.degraded).toBe(false)
      expect(result.meta.cacheHit).toBe(false)
      expect(result.meta.contentHash).toBeDefined()
      expect(result.meta.listingHash).toBeDefined()
      expect(result.meta.promptVersion).toBeDefined()
      expect(result.meta.schemaVersion).toBeDefined()
    }).pipe(
      Effect.provide(
        TestLayer.pipe(
          Layer.provide(makeStubOpenRouterClient()),
          Layer.provide(StubQuotaService),
        ),
      ),
    ))

  it.effect("stage 1 failure returns TailorError", () =>
    Effect.gen(function*() {
      const service = yield* Services.TailorService.TailorService
      const content = ResumeContent.INITIAL_CONTENT_STATE

      const exit = yield* Effect.exit(
        service.tailorResume("user@example.com", "Some job listing", content, "v1"),
      )

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const errorOption = Cause.findErrorOption(exit.cause)
        expect(errorOption._tag).toBe("Some")
        if (errorOption._tag === "Some") {
          expect(errorOption.value._tag).toBe("TailorError")
          if (errorOption.value._tag === "TailorError") {
            expect(errorOption.value.message).toContain("Stage 1 (cleanup) failed")
            expect(errorOption.value.message).toContain("Stage 1 failed")
          }
        }
      }
    }).pipe(
      Effect.provide(
        TestLayer.pipe(
          Layer.provide(makeStubOpenRouterClient(undefined, undefined, true)),
          Layer.provide(StubQuotaService),
        ),
      ),
    ))

  it.effect("stage 2 failure returns TailorError", () =>
    Effect.gen(function*() {
      const service = yield* Services.TailorService.TailorService
      const content = ResumeContent.INITIAL_CONTENT_STATE

      const exit = yield* Effect.exit(
        service.tailorResume("user@example.com", "Some job listing", content, "v1"),
      )

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const errorOption = Cause.findErrorOption(exit.cause)
        expect(errorOption._tag).toBe("Some")
        if (errorOption._tag === "Some") {
          expect(errorOption.value._tag).toBe("TailorError")
          if (errorOption.value._tag === "TailorError") {
            expect(errorOption.value.message).toContain("Stage 2 (tailor) failed")
            expect(errorOption.value.message).toContain("Stage 2 failed")
          }
        }
      }
    }).pipe(
      Effect.provide(
        TestLayer.pipe(
          Layer.provide(makeStubOpenRouterClient(undefined, undefined, false, true)),
          Layer.provide(StubQuotaService),
        ),
      ),
    ))

  it.effect("quota exceeded returns TailorQuotaExceeded error", () =>
    Effect.gen(function*() {
      const service = yield* Services.TailorService.TailorService
      const content = ResumeContent.INITIAL_CONTENT_STATE

      const result = yield* Effect.exit(
        service.tailorResume("user@example.com", "Some listing", content, "v1"),
      )

      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        const errorOption = Cause.findErrorOption(result.cause)
        expect(errorOption._tag).toBe("Some")
        if (errorOption._tag === "Some") {
          expect(errorOption.value._tag).toBe("TailorQuotaExceeded")
          if (errorOption.value._tag === "TailorQuotaExceeded") {
            expect(errorOption.value.retryAfterSeconds).toBe(3600)
          }
        }
      }
    }).pipe(
      Effect.provide(
        TestLayer.pipe(
          Layer.provide(makeStubOpenRouterClient()),
          Layer.provide(ExhaustedQuotaService),
        ),
      ),
    ))

  it.effect("computes contentHash and listingHash", () =>
    Effect.gen(function*() {
      const service = yield* Services.TailorService.TailorService
      const content = ResumeContent.INITIAL_CONTENT_STATE

      const result = yield* service.tailorResume(
        "user@example.com",
        "Test listing",
        content,
        "v1",
      )

      // Hashes should be 64-char hex strings (SHA-256)
      expect(result.meta.contentHash).toMatch(/^[a-f0-9]{64}$/)
      expect(result.meta.listingHash).toMatch(/^[a-f0-9]{64}$/)

      // Same content should produce same hash
      const result2 = yield* service.tailorResume(
        "user@example.com",
        "Test listing",
        content,
        "v1",
      )
      expect(result2.meta.contentHash).toBe(result.meta.contentHash)
      expect(result2.meta.listingHash).toBe(result.meta.listingHash)
    }).pipe(
      Effect.provide(
        TestLayer.pipe(
          Layer.provide(makeStubOpenRouterClient()),
          Layer.provide(StubQuotaService),
        ),
      ),
    ))

  it.effect("different listings produce different listingHash", () =>
    Effect.gen(function*() {
      const service = yield* Services.TailorService.TailorService
      const content = ResumeContent.INITIAL_CONTENT_STATE

      const result1 = yield* service.tailorResume(
        "user@example.com",
        "First listing",
        content,
        "v1",
      )

      const result2 = yield* service.tailorResume(
        "user@example.com",
        "Second listing",
        content,
        "v1",
      )

      expect(result1.meta.listingHash).not.toBe(result2.meta.listingHash)
    }).pipe(
      Effect.provide(
        TestLayer.pipe(
          Layer.provide(makeStubOpenRouterClient()),
          Layer.provide(StubQuotaService),
        ),
      ),
    ))

  // Note: The merge-delta guard is a safety net for edge cases where edits slip through
  // validation but would produce non-replace JSON Patch operations. Testing this requires
  // constructing a scenario where edits pass all validation but the merge produces non-replace
  // ops, which is complex and depends on the initial content structure. The guard is tested
  // implicitly through integration tests.

  it.effect("unexpected error wraps into TailorError", () => {
    // Stub that throws an unexpected error (not a TailorError)
    const failingClient = Layer.succeed(Services.OpenRouterClientService.OpenRouterClientService, {
      chat: (_req: any) => Effect.die(new Error("Unexpected network failure")),
    })

    return Effect.gen(function*() {
      const service = yield* Services.TailorService.TailorService
      const content = ResumeContent.INITIAL_CONTENT_STATE

      const exit = yield* Effect.exit(
        service.tailorResume("user@example.com", "Some listing", content, "v1"),
      )

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const errorOption = Cause.findErrorOption(exit.cause)
        expect(errorOption._tag).toBe("Some")
        if (errorOption._tag === "Some") {
          expect(errorOption.value._tag).toBe("TailorError")
          if (errorOption.value._tag === "TailorError") {
            expect(errorOption.value.message).toContain("Tailor pipeline failed")
            expect(errorOption.value.message).toContain("Unexpected network failure")
          }
        }
      }
    }).pipe(
      Effect.provide(
        TestLayer.pipe(
          Layer.provide(failingClient),
          Layer.provide(StubQuotaService),
        ),
      ),
    )
  })
})
