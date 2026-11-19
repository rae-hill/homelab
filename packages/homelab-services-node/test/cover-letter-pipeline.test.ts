import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { Config, Services } from "homelab-services"
import { ResumeContent } from "shared"
import { CoverLetterPromptConfigServiceLive } from "../src/layers/cover-letter-prompt-config-service.js"
import { CoverLetterServiceLive } from "../src/layers/cover-letter-service.js"
import { CoverLetterTemplateServiceLive } from "../src/layers/cover-letter-template-service.js"
import { HashingServiceSha256Live } from "../src/layers/hashing-service-sha256.js"
import { PromptSanitizationServiceLive } from "../src/layers/prompt-sanitization-service.js"

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])

const validGeneration = JSON.stringify({
  subject: "Senior Software Engineer Position",
  paragraphs: [
    "Hello! My name is Rae, and I am writing about the Senior Software Engineer role.".padEnd(120, " More."),
    "I have spent my career between full-stack and platform work, and this listing stood out.".padEnd(120, " More."),
  ],
})

interface RecordedCall {
  model: string
  messages: ReadonlyArray<Services.OpenRouterClientService.ChatMessage>
}

/** Programmable OpenRouter stub: serves canned responses in order, records every call. */
const makeStubOpenRouter = (responses: ReadonlyArray<string>) => {
  const calls: Array<RecordedCall> = []
  const queue = [...responses]
  const layer = Layer.succeed(Services.OpenRouterClientService.OpenRouterClientService, {
    chat: (req) =>
      Effect.gen(function*() {
        calls.push({ model: req.model, messages: req.messages })
        const content = queue.shift()
        if (content === undefined) {
          return yield* Effect.fail(
            new Services.OpenRouterClientService.OpenRouterError({
              message: "stub exhausted: unexpected extra chat call",
              error: null,
            }),
          )
        }
        return {
          content,
          finishReason: "stop",
          usage: { promptTokens: 200, completionTokens: 150 },
        }
      }),
  })
  return { calls, layer }
}

const StubExtraction = Layer.succeed(
  Services.ResumeListingExtractionService.ResumeListingExtractionService,
  {
    extract: () =>
      Effect.succeed({
        cleanedListing: "Cleaned listing for Senior Software Engineer",
        jobTitle: "Senior Software Engineer",
        company: "Acme Corp",
        stage: { model: "test-cleanup-model", promptTokens: 100, completionTokens: 50, latencyMs: 10 },
        fromCache: false,
      }),
  },
)

const FailingExtraction = Layer.succeed(
  Services.ResumeListingExtractionService.ResumeListingExtractionService,
  {
    extract: () =>
      Effect.fail(
        new Services.ResumeListingExtractionService.ListingExtractionError({
          message: "Stage 1 (cleanup) failed",
          error: null,
        }),
      ),
  },
)

const StubQuota = Layer.succeed(Services.TailorQuotaService.TailorQuotaService, {
  tryConsume: () => Effect.void,
})

const ExhaustedQuota = Layer.succeed(Services.TailorQuotaService.TailorQuotaService, {
  tryConsume: () => Effect.fail(new Services.TailorService.TailorQuotaExceeded({ retryAfterSeconds: 3600 })),
})

const StubTypst = Layer.succeed(Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypst, {
  renderPdf: () => Effect.succeed(PDF_BYTES),
})

const NotPdfTypst = Layer.succeed(Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypst, {
  renderPdf: () => Effect.succeed(new TextEncoder().encode("NOPE")),
})

const FailingTypst = Layer.succeed(Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypst, {
  renderPdf: () =>
    Effect.fail(
      new Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypstError({
        message: "typst compilation failed: boom",
        error: null,
      }),
    ),
})

const StubEnv = Layer.succeed(Config.Env.Env, {
  openRouterApiKeyFile: { _tag: "Some", value: "/fake/path" } as any,
  openRouterModel: "test-model",
  openRouterCleanupModel: "test-cleanup-model",
  openRouterCoverLetterModel: "test-cover-letter-model",
  openRouterBaseUrl: new URL("https://openrouter.ai/api/v1"),
  typstAssetsDir: Option.some("/fake/typst-assets"),
} as any)

interface LayerOverrides {
  quota?: Layer.Layer<Services.TailorQuotaService.TailorQuotaService>
  extraction?: Layer.Layer<Services.ResumeListingExtractionService.ResumeListingExtractionService>
  typst?: Layer.Layer<Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypst>
}

const buildLayer = (
  openRouter: Layer.Layer<Services.OpenRouterClientService.OpenRouterClientService>,
  overrides: LayerOverrides = {},
) =>
  CoverLetterServiceLive.pipe(
    Layer.provide(openRouter),
    Layer.provide(overrides.quota ?? StubQuota),
    Layer.provide(overrides.extraction ?? StubExtraction),
    Layer.provide(PromptSanitizationServiceLive),
    Layer.provide(CoverLetterPromptConfigServiceLive),
    Layer.provide(CoverLetterTemplateServiceLive),
    Layer.provide(overrides.typst ?? StubTypst),
    Layer.provide(HashingServiceSha256Live),
    Layer.provide(StubEnv),
  )

const generate = (listing = "Senior Software Engineer role requiring TypeScript and React") =>
  Effect.gen(function*() {
    const service = yield* Services.CoverLetterService.CoverLetterService
    return yield* service.generateCoverLetter(
      "user@example.com",
      listing,
      ResumeContent.INITIAL_CONTENT_STATE,
      "v1",
    )
  })

describe("cover letter pipeline", () => {
  it.effect("happy path returns %PDF bytes using the cover-letter model", () => {
    const openRouter = makeStubOpenRouter([validGeneration])
    return Effect.gen(function*() {
      const pdf = yield* generate()
      expect(Array.from(pdf.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46])
      expect(openRouter.calls).toHaveLength(1)
      expect(openRouter.calls[0]!.model).toBe("test-cover-letter-model")
    }).pipe(Effect.provide(buildLayer(openRouter.layer)))
  })

  it.effect("passes TailorQuotaExceeded through untouched and skips generation", () => {
    const openRouter = makeStubOpenRouter([])
    return Effect.gen(function*() {
      const result = yield* Effect.flip(generate())
      expect(result._tag).toBe("TailorQuotaExceeded")
      if (result._tag === "TailorQuotaExceeded") {
        expect(result.retryAfterSeconds).toBe(3600)
      }
      expect(openRouter.calls).toHaveLength(0)
    }).pipe(Effect.provide(buildLayer(openRouter.layer, { quota: ExhaustedQuota })))
  })

  it.effect("retries ONCE on decode failure, appending the decoder error as a correction", () => {
    const openRouter = makeStubOpenRouter(["not valid json at all", validGeneration])
    return Effect.gen(function*() {
      const pdf = yield* generate()
      expect(Array.from(pdf.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46])
      expect(openRouter.calls).toHaveLength(2)
      const retryMessages = openRouter.calls[1]!.messages
      // original system + user, then the failed assistant output, then the correction
      expect(retryMessages).toHaveLength(4)
      expect(retryMessages[2]!.role).toBe("assistant")
      expect(retryMessages[2]!.content).toBe("not valid json at all")
      expect(retryMessages[3]!.role).toBe("user")
      expect(retryMessages[3]!.content).toContain("failed schema decoding")
    }).pipe(Effect.provide(buildLayer(openRouter.layer)))
  })

  it.effect("fails typed when the retry output is still undecodable", () => {
    const openRouter = makeStubOpenRouter(["garbage one", "garbage two"])
    return Effect.gen(function*() {
      const error = yield* Effect.flip(generate())
      expect(error._tag).toBe("CoverLetterError")
      if (error._tag === "CoverLetterError") {
        expect(error.message).toContain("not valid JSON after retry")
      }
    }).pipe(Effect.provide(buildLayer(openRouter.layer)))
  })

  it.effect("fails typed on validation violations (no silent trimming)", () => {
    const oneParagraph = JSON.stringify({ subject: "Role", paragraphs: ["Only one paragraph."] })
    const openRouter = makeStubOpenRouter([oneParagraph, oneParagraph])
    return Effect.gen(function*() {
      const error = yield* Effect.flip(generate())
      expect(error._tag).toBe("CoverLetterError")
      if (error._tag === "CoverLetterError") {
        expect(error.message).toContain("failed validation")
      }
    }).pipe(Effect.provide(buildLayer(openRouter.layer)))
  })

  it.effect("fails typed when the rendered bytes are not a PDF", () => {
    const openRouter = makeStubOpenRouter([validGeneration])
    return Effect.gen(function*() {
      const error = yield* Effect.flip(generate())
      expect(error._tag).toBe("CoverLetterError")
      if (error._tag === "CoverLetterError") {
        expect(error.message).toContain("not a PDF")
      }
    }).pipe(Effect.provide(buildLayer(openRouter.layer, { typst: NotPdfTypst })))
  })

  it.effect("wraps stage-1 extraction failures as CoverLetterError", () => {
    const openRouter = makeStubOpenRouter([])
    return Effect.gen(function*() {
      const error = yield* Effect.flip(generate())
      expect(error._tag).toBe("CoverLetterError")
      if (error._tag === "CoverLetterError") {
        expect(error.message).toContain("Stage 1 (cleanup) failed")
      }
      expect(openRouter.calls).toHaveLength(0)
    }).pipe(Effect.provide(buildLayer(openRouter.layer, { extraction: FailingExtraction })))
  })

  it.effect("wraps renderer failures as CoverLetterError", () => {
    const openRouter = makeStubOpenRouter([validGeneration])
    return Effect.gen(function*() {
      const error = yield* Effect.flip(generate())
      expect(error._tag).toBe("CoverLetterError")
      if (error._tag === "CoverLetterError") {
        expect(error.message).toContain("render failed")
      }
    }).pipe(Effect.provide(buildLayer(openRouter.layer, { typst: FailingTypst })))
  })
})
