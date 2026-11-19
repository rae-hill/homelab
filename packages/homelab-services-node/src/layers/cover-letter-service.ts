import { Clock, Duration, Effect, Layer, Result, Schema } from "effect"
import { Config, Services, Utils } from "homelab-services"
import type { ResumeContent as ResumeContentType } from "shared"
import { CoverLetterGeneration as CoverLetterGenerationWire } from "../schemas/CoverLetter.js"
import { validateCoverLetterGeneration } from "./cover-letter/validation.js"

/**
 * CoverLetterService implementation — the cover-letter orchestrator
 * (docs/cover-letter-generator/01 §C). Mirrors tailor-service.ts: the orchestrator is a
 * pure consumer of service tags; every failure wraps into CoverLetterError (raw nested
 * cause, D12 semantics) except TailorQuotaExceeded, which passes through for the
 * handler's 400 mapping.
 *
 * Pipeline:
 * 1. hygiene → truncate → listingHash (PromptSanitizationService + HashingServiceSha256)
 * 2. quota tryConsume (SHARED TailorQuotaService budget — CL-D7)
 * 3. stage 1: cleanup via the CACHED extraction decorator (hit expected right after
 *    tailoring the same listing — CL-D6)
 * 4. stage 2: generation (CoverLetterPromptConfigService + OpenRouterClientService,
 *    strict JSON schema, ONE decode-failure retry with the decoder error appended)
 * 5. validation (layers/cover-letter/validation.ts — hard fail, no silent trimming)
 * 6. render: CoverLetterTemplateService → DocumentRenderingServiceTypst → %PDF check
 * 7. meta logging (never letter/listing text — doc 02 §H rule)
 */

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] as const // "%PDF"

export const CoverLetterServiceLive = Layer.effect(
  Services.CoverLetterService.CoverLetterService,
  Effect.gen(function*() {
    const env = yield* Config.Env.Env
    const openRouterClient = yield* Services.OpenRouterClientService.OpenRouterClientService
    const quotaService = yield* Services.TailorQuotaService.TailorQuotaService
    const sanitizationService = yield* Services.PromptSanitizationService.PromptSanitizationService
    const extractionService = yield* Services.ResumeListingExtractionService.ResumeListingExtractionService
    const promptConfigService = yield* Services.CoverLetterPromptConfigService.CoverLetterPromptConfigService
    const templateService = yield* Services.CoverLetterTemplateService.CoverLetterTemplateService
    const typstRenderer = yield* Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypst
    const hashingService = yield* Services.HashingServiceSha256.HashingServiceSha256

    return new CoverLetterServiceImpl(
      env,
      openRouterClient,
      quotaService,
      sanitizationService,
      extractionService,
      promptConfigService,
      templateService,
      typstRenderer,
      hashingService,
    )
  }),
)

class CoverLetterServiceImpl implements Services.CoverLetterService.CoverLetterServiceDef {
  constructor(
    private readonly env: typeof Config.Env.Env.Service,
    private readonly openRouterClient: Services.OpenRouterClientService.OpenRouterClientServiceDef,
    private readonly quotaService: Services.TailorQuotaService.TailorQuotaServiceDef,
    private readonly sanitizationService: Services.PromptSanitizationService.PromptSanitizationServiceDef,
    private readonly extractionService: Services.ResumeListingExtractionService.ResumeListingExtractionServiceDef,
    private readonly promptConfigService: Services.CoverLetterPromptConfigService.CoverLetterPromptConfigServiceDef,
    private readonly templateService: Services.CoverLetterTemplateService.CoverLetterTemplateServiceDef,
    private readonly typstRenderer: Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypstDef,
    private readonly hashingService: Services.HashingServiceSha256.HashingServiceSha256Def,
  ) {}

  private fail(message: string, error: unknown) {
    return Effect.fail(
      new Services.CoverLetterService.CoverLetterError({ message, error: Utils.errorToJson(error) }),
    )
  }

  generateCoverLetter(
    subject: string,
    listing: string,
    content: ResumeContentType.ContentState,
    baseVersion: string,
  ): Effect.Effect<
    Uint8Array,
    Services.CoverLetterService.CoverLetterError | Services.TailorService.TailorQuotaExceeded
  > {
    return Effect.gen({ self: this }, function*() {
      // 1. Hygiene + listingHash (same normalize-then-hash contract as TailorMeta).
      const sanitized = this.sanitizationService.sanitize(listing)
      const listingHash = yield* this.hashingService.digestHex(sanitized)
      const { sanitized: hygienedListing, truncated } = this.sanitizationService.hygienize(listing)
      if (truncated) {
        yield* Effect.logInfo("[cover-letter] listing truncated from middle", {
          originalLength: listing.length,
          truncatedLength: hygienedListing.length,
        })
      }

      // 2. Quota (shared AI-spend budget with tailoring — CL-D7).
      yield* this.quotaService.tryConsume(subject)

      // 3. Stage 1: cleanup — usually a CACHE HIT right after tailoring the same listing.
      const stage1 = yield* this.extractionService.extract({ listing: hygienedListing }).pipe(
        Effect.catch((err) =>
          Effect.flatMap(Effect.logError("Stage 1 (cleanup) failed"), () => this.fail("Stage 1 (cleanup) failed", err))
        ),
      )
      yield* Effect.logInfo("[cover-letter] stage 1 resolved", {
        cacheHit: stage1.fromCache,
        model: stage1.stage.model,
      })

      // 4. Stage 2: generation (one decode-failure retry, doc 01 §B).
      const stage2StartTime = yield* Clock.currentTimeMillis
      const messages = this.promptConfigService.buildGenerationMessages({
        cleanedListing: stage1.cleanedListing,
        jobTitle: stage1.jobTitle,
        company: stage1.company,
        content,
      })
      const responseFormat = this.promptConfigService.buildGenerationResponseFormat()

      const firstResponse = yield* this.openRouterClient
        .chat({
          model: this.env.openRouterCoverLetterModel,
          messages,
          responseFormat,
          maxTokens: 4000,
          timeout: Duration.seconds(60),
        })
        .pipe(
          Effect.catch((err) =>
            Effect.flatMap(
              Effect.logError("Stage 2 (generation) failed"),
              () => this.fail("Stage 2 (generation) failed", err),
            )
          ),
        )

      const firstDecode = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(CoverLetterGenerationWire),
      )(firstResponse.content).pipe(Effect.result)

      let generation: typeof CoverLetterGenerationWire.Type
      let tokens = {
        input: firstResponse.usage.promptTokens,
        output: firstResponse.usage.completionTokens,
      }
      if (Result.isSuccess(firstDecode)) {
        generation = firstDecode.success
      } else {
        yield* Effect.logInfo("[cover-letter] generation output failed decode; retrying once")
        const retryMessages: Array<Services.OpenRouterClientService.ChatMessage> = [
          ...messages,
          { role: "assistant", content: firstResponse.content },
          {
            role: "user",
            content: `Your previous response failed schema decoding: ${
              JSON.stringify(Utils.errorToJson(firstDecode.failure))
            }. Respond again with ONLY valid JSON matching the required schema.`,
          },
        ]
        const retryResponse = yield* this.openRouterClient
          .chat({
            model: this.env.openRouterCoverLetterModel,
            messages: retryMessages,
            responseFormat,
            maxTokens: 4000,
            timeout: Duration.seconds(60),
          })
          .pipe(
            Effect.catch((err) =>
              Effect.flatMap(
                Effect.logError("Stage 2 (generation) retry failed"),
                () => this.fail("Stage 2 (generation) retry failed", err),
              )
            ),
          )
        tokens = {
          input: tokens.input + retryResponse.usage.promptTokens,
          output: tokens.output + retryResponse.usage.completionTokens,
        }
        generation = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(CoverLetterGenerationWire),
        )(retryResponse.content).pipe(
          Effect.catch((error) =>
            Effect.flatMap(
              Effect.logError("Stage 2 (generation) output undecodable after retry"),
              () => this.fail("Stage 2 (generation) output was not valid JSON after retry", error),
            )
          ),
        )
      }

      const stage2EndTime = yield* Clock.currentTimeMillis

      // 5. Validation — hard fail on violation (no silent trimming).
      const validated = validateCoverLetterGeneration(generation)
      if (!validated.ok) {
        return yield* this.fail("Generated cover letter failed validation", validated.violations)
      }

      // 6. Render: template assembly → typst PDF → %PDF magic defense-in-depth.
      const doc = yield* this.templateService
        .buildLetter({
          subject: validated.subject,
          paragraphs: validated.paragraphs,
          company: stage1.company,
        })
        .pipe(
          Effect.catch((err) =>
            Effect.flatMap(
              Effect.logError("Cover-letter template assembly failed"),
              () => this.fail("Cover-letter template assembly failed", err),
            )
          ),
        )

      const pdf = yield* this.typstRenderer.renderPdf(doc).pipe(
        Effect.catch((err) =>
          Effect.flatMap(
            Effect.logError("Cover-letter render failed"),
            () => this.fail("Cover-letter render failed", err),
          )
        ),
      )

      if (pdf.length < 4 || PDF_MAGIC.some((byte, index) => pdf[index] !== byte)) {
        return yield* this.fail("Rendered cover letter is not a PDF (%PDF magic missing)", {
          byteLength: pdf.length,
        })
      }

      // 7. Meta only — never letter/listing text (doc 02 §H logging rule).
      yield* Effect.logInfo("[cover-letter] pipeline succeeded", {
        model: this.env.openRouterCoverLetterModel,
        tokens,
        latencyMs: stage2EndTime - stage2StartTime,
        stage1CacheHit: stage1.fromCache,
        listingHash,
        pdfBytes: pdf.length,
      })

      return pdf
    }).pipe(
      Effect.annotateLogs({
        subject,
        baseVersion,
        promptVersion: this.promptConfigService.version,
        schemaVersion: this.promptConfigService.schemaVersion,
      }),
      Effect.catch((error) => {
        // Pass through typed errors unchanged (quota 400 / pipeline 500 mapping).
        if (
          error instanceof Services.CoverLetterService.CoverLetterError ||
          error instanceof Services.TailorService.TailorQuotaExceeded
        ) {
          return Effect.fail(error)
        }
        return Effect.flatMap(
          Effect.logError("Cover-letter pipeline failed"),
          () => this.fail("Cover-letter pipeline failed", error),
        )
      }),
      Effect.catchDefect((defect) =>
        Effect.flatMap(
          Effect.logError("Cover-letter pipeline failed"),
          () => this.fail("Cover-letter pipeline failed", defect),
        )
      ),
    )
  }
}
