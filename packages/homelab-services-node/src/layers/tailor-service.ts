import { Clock, Duration, Effect, Layer, Schema } from "effect"
import { Config, Schemas, Services, Utils } from "homelab-services"
import { Schemas as NodeSchemas } from "homelab-services-node"
import type { ResumeContent as ResumeContentType } from "shared"

/**
 * Real TailorService implementation composing the two-stage AI pipeline.
 *
 * Pipeline (doc 07 §B):
 * 1. hygiene → truncate (PromptSanitizationService)
 * 2. quota.tryConsume(subject) (TailorQuotaService)
 * 3. stage 1 (cleanup) (ResumeListingExtractionService)
 * 4. stage 2 (tailor) (OpenRouterClientService + ResumePromptConfigService)
 * 5. validation pipeline (ResumeTailorValidationService)
 * 6. merge + delta guard (ResumeContentMergeService)
 * 7. keyword coverage (ResumeTailorValidationService)
 * 8. Return TailorResult
 *
 * The orchestrator is a pure consumer of the five service tags — no imports from tailor/*.
 */

export const TailorServiceLive = Layer.effect(
  Services.TailorService.TailorService,
  Effect.gen(function*() {
    const env = yield* Config.Env.Env
    const openRouterClient = yield* Services.OpenRouterClientService.OpenRouterClientService
    const quotaService = yield* Services.TailorQuotaService.TailorQuotaService
    const sanitizationService = yield* Services.PromptSanitizationService.PromptSanitizationService
    const extractionService = yield* Services.ResumeListingExtractionService.ResumeListingExtractionService
    const promptConfigService = yield* Services.ResumePromptConfigService.ResumePromptConfigService
    const validationService = yield* Services.ResumeTailorValidationService.ResumeTailorValidationService
    const mergeService = yield* Services.ResumeContentMergeService.ResumeContentMergeService
    const hashingService = yield* Services.HashingServiceSha256.HashingServiceSha256

    return new TailorServiceImpl(
      env,
      openRouterClient,
      quotaService,
      sanitizationService,
      extractionService,
      promptConfigService,
      validationService,
      mergeService,
      hashingService,
    )
  }),
)

class TailorServiceImpl implements Services.TailorService.TailorServiceDef {
  constructor(
    private readonly env: typeof Config.Env.Env.Service,
    private readonly openRouterClient: Services.OpenRouterClientService.OpenRouterClientServiceDef,
    private readonly quotaService: Services.TailorQuotaService.TailorQuotaServiceDef,
    private readonly sanitizationService: Services.PromptSanitizationService.PromptSanitizationServiceDef,
    private readonly extractionService: Services.ResumeListingExtractionService.ResumeListingExtractionServiceDef,
    private readonly promptConfigService: Services.ResumePromptConfigService.ResumePromptConfigServiceDef,
    private readonly validationService: Services.ResumeTailorValidationService.ResumeTailorValidationServiceDef,
    private readonly mergeService: Services.ResumeContentMergeService.ResumeContentMergeServiceDef,
    private readonly hashingService: Services.HashingServiceSha256.HashingServiceSha256Def,
  ) {}

  tailorResume(
    subject: string,
    listing: string,
    content: ResumeContentType.ContentState,
    baseVersion: string,
  ): Effect.Effect<
    Services.TailorService.TailorResult,
    Services.TailorService.TailorError | Services.TailorService.TailorQuotaExceeded
  > {
    return Effect.gen({ self: this }, function*() {
      // Compute hashes for meta
      const sanitized = this.sanitizationService.sanitize(listing)
      const listingHash = yield* this.hashingService.digestHex(sanitized)
      const contentHash = yield* this.hashingService.digestHex(JSON.stringify(content))

      yield* Effect.logDebug("[tailor] pipeline starting", {
        listingLength: listing.length,
        contentHashPrefix: contentHash.slice(0, 12),
      })

      // 1. Hygiene + truncate (via PromptSanitizationService)
      const { sanitized: hygienedListing, truncated } = this.sanitizationService.hygienize(listing)
      if (truncated) {
        yield* Effect.logInfo("[tailor] listing truncated from middle", {
          originalLength: listing.length,
          truncatedLength: hygienedListing.length,
        })
      }

      // 2. Quota check
      yield* this.quotaService.tryConsume(subject)

      // 3. Stage 1: Cleanup (via ResumeListingExtractionService)
      const stage1Result = yield* this.extractionService.extract({
        listing: hygienedListing,
      }).pipe(
        Effect.catch((err) =>
          Effect.flatMap(
            Effect.logError("Stage 1 (cleanup) failed"),
            () =>
              Effect.fail(
                new Services.TailorService.TailorError({
                  message: "Stage 1 (cleanup) failed",
                  error: Utils.errorToJson(err),
                }),
              ),
          )
        ),
      )

      yield* Effect.logInfo("Stage 1 (cleanup) succeeded", {
        model: stage1Result.stage.model,
        tokens: {
          input: stage1Result.stage.promptTokens,
          output: stage1Result.stage.completionTokens,
        },
        latencyMs: stage1Result.stage.latencyMs,
      })

      const cleanedListing = stage1Result.cleanedListing
      const jobTitle = stage1Result.jobTitle
      const company = stage1Result.company

      // 4. Stage 2: Tailor (via ResumePromptConfigService + OpenRouterClientService)
      const stage2StartTime = yield* Clock.currentTimeMillis
      const tailorMessages = this.promptConfigService.buildTailorMessages({ cleanedListing, content })
      const tailorResponseFormat = this.promptConfigService.buildTailorResponseFormat()

      const stage2Result = yield* this.openRouterClient
        .chat({
          model: this.env.openRouterModel,
          messages: tailorMessages,
          responseFormat: tailorResponseFormat,
          maxTokens: 8000,
          timeout: Duration.seconds(60),
        })
        .pipe(
          Effect.flatMap((response) => {
            // Parse JSON via schema
            return Schema.decodeUnknownEffect(
              Schema.fromJsonString(NodeSchemas.Tailoring.TailorEdits),
            )(response.content).pipe(
              Effect.mapError((error) =>
                new Services.TailorService.TailorError({
                  message: "Stage 2 (tailor) output was not valid JSON",
                  error: Utils.errorToJson(error),
                })
              ),
              Effect.flatMap((edits) =>
                Clock.currentTimeMillis.pipe(
                  Effect.map((endTime) => ({
                    edits,
                    tokens: {
                      input: response.usage.promptTokens,
                      output: response.usage.completionTokens,
                    },
                    latencyMs: endTime - stage2StartTime,
                  })),
                )
              ),
            )
          }),
          Effect.catch((err) =>
            Effect.flatMap(
              Effect.logError("Stage 2 (tailor) failed"),
              () =>
                Effect.fail(
                  new Services.TailorService.TailorError({
                    message: "Stage 2 (tailor) failed",
                    error: Utils.errorToJson(err),
                  }),
                ),
            )
          ),
        )

      yield* Effect.logInfo("Stage 2 (tailor) succeeded", {
        model: this.env.openRouterModel,
        tokens: stage2Result.tokens,
        latencyMs: stage2Result.latencyMs,
      })

      // 5. Validation pipeline (via ResumeTailorValidationService)
      // Use default permissive policy (enabled=false) — T15 adds policy parameter
      const policy = Schemas.ResumeTailor.DEFAULT_TAILOR_VALIDATION_POLICY

      const validation = yield* this.validationService.validateEdits({
        content,
        edits: stage2Result.edits,
        cleanedListing,
        policy,
      }).pipe(
        Effect.catch((err) =>
          Effect.flatMap(
            Effect.logError("Validation failed"),
            () =>
              Effect.fail(
                new Services.TailorService.TailorError({
                  message: "Validation failed",
                  error: Utils.errorToJson(err),
                }),
              ),
          )
        ),
      )

      const edits = validation.edits

      if (validation.dropped.length > 0) {
        yield* Effect.logInfo("[tailor] dropped edits during validation", {
          dropped: validation.dropped,
        })
      }

      // 5e. Merge (via ResumeContentMergeService)
      const mergeResult = yield* this.mergeService.merge({
        content,
        edits,
        policy,
      }).pipe(
        Effect.catch((err) =>
          Effect.flatMap(
            Effect.logError("Merge failed"),
            () =>
              Effect.fail(
                new Services.TailorService.TailorError({
                  message: "Merge failed",
                  error: Utils.errorToJson(err),
                }),
              ),
          )
        ),
      )

      const mergedContent = mergeResult.merged
      // Note: mergeResult.delta and mergeResult.changes are available for T15 wire changes

      // 5f. Keyword coverage (via ResumeTailorValidationService)
      const coverage = yield* this.validationService.computeKeywordCoverage({
        merged: mergedContent,
        required: edits.fit.keywordCoverage.required,
      }).pipe(
        Effect.catch((err) =>
          Effect.flatMap(
            Effect.logError("Keyword coverage computation failed"),
            () =>
              Effect.fail(
                new Services.TailorService.TailorError({
                  message: "Keyword coverage computation failed",
                  error: Utils.errorToJson(err),
                }),
              ),
          )
        ),
      )

      // 6. Build final result
      const fitReport = {
        ...edits.fit,
        keywordCoverage: {
          required: edits.fit.keywordCoverage.required,
          matched: coverage.matched,
          missing: coverage.missing,
        },
      }

      const stage1Meta = {
        model: stage1Result.stage.model,
        tokens: {
          input: stage1Result.stage.promptTokens,
          output: stage1Result.stage.completionTokens,
        },
        latencyMs: stage1Result.stage.latencyMs,
      }

      const stage2Meta = {
        model: this.env.openRouterModel,
        tokens: stage2Result.tokens,
        latencyMs: stage2Result.latencyMs,
      }

      return {
        jobTitle,
        company,
        content: mergedContent,
        baseVersion,
        fit: fitReport,
        meta: {
          stage1: stage1Meta,
          stage2: stage2Meta,
          degraded: false,
          cacheHit: false,
          contentHash,
          listingHash,
          promptVersion: this.promptConfigService.version,
          schemaVersion: this.promptConfigService.schemaVersion,
        },
      }
    }).pipe(
      Effect.annotateLogs({
        subject,
        promptVersion: this.promptConfigService.version,
        schemaVersion: this.promptConfigService.schemaVersion,
      }),
      Effect.catch((error) => {
        // Pass through typed errors unchanged
        if (
          error instanceof Services.TailorService.TailorError ||
          error instanceof Services.TailorService.TailorQuotaExceeded
        ) {
          return Effect.fail(error)
        }
        // Wrap unexpected typed errors
        return Effect.flatMap(
          Effect.logError("Tailor pipeline failed"),
          () =>
            Effect.fail(
              new Services.TailorService.TailorError({
                message: "Tailor pipeline failed",
                error: Utils.errorToJson(error),
              }),
            ),
        )
      }),
      Effect.catchDefect((defect) => {
        // Catch defects (uncaught exceptions) and wrap them
        return Effect.flatMap(
          Effect.logError("Tailor pipeline failed"),
          () =>
            Effect.fail(
              new Services.TailorService.TailorError({
                message: "Tailor pipeline failed",
                error: Utils.errorToJson(defect),
              }),
            ),
        )
      }),
    )
  }
}
