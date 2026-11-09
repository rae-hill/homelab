import { Clock, Duration, Effect, Layer } from "effect"
import { Config, Services, Utils } from "homelab-services"
import { createHash } from "node:crypto"
import { ResumeContent } from "shared"
import type { ResumeContent as ResumeContentType } from "shared"
import { runCleanupStage } from "./tailor/cleanup.js"
import { sanitize, truncate } from "./tailor/hygiene.js"
import { buildTailorMessages, buildTailorResponseFormat } from "./tailor/prompts.js"
import {
  checkEvidence,
  checkFabrication,
  checkTagInvariance,
  computeKeywordCoverage,
  mergeEdits,
  resolveIds,
} from "./tailor/validation.js"
import { promptVersion, schemaVersion, type TailorEdits } from "./tailor/wire-schema.js"

/**
 * Real TailorService implementation composing the two-stage AI pipeline.
 *
 * Pipeline (doc 02 §B):
 * 1. hygiene → truncate
 * 2. quota.tryConsume(subject)
 * 3. stage 1 (cleanup)
 * 4. stage 2 (tailor)
 * 5. validation pipeline (decode → ID resolution → tag guard → fabrication → evidence → merge → coverage → delta-assert)
 * 6. Return TailorResult
 */

export const TailorServiceLive = Layer.effect(
  Services.TailorService.TailorService,
  Effect.gen(function*() {
    const env = yield* Config.Env.Env
    const openRouterClient = yield* Services.OpenRouterClientService.OpenRouterClientService
    const quotaService = yield* Services.TailorQuotaService.TailorQuotaService

    return new TailorServiceImpl(env, openRouterClient, quotaService)
  }),
)

class TailorServiceImpl implements Services.TailorService.TailorServiceDef {
  constructor(
    private readonly env: typeof Config.Env.Env.Service,
    private readonly openRouterClient: Services.OpenRouterClientService.OpenRouterClientServiceDef,
    private readonly quotaService: Services.TailorQuotaService.TailorQuotaServiceDef,
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
      const listingHash = createHash("sha256").update(sanitize(listing)).digest("hex")
      const contentHash = createHash("sha256")
        .update(JSON.stringify(content))
        .digest("hex")

      yield* Effect.logDebug("[tailor] pipeline starting", {
        listingLength: listing.length,
        contentHashPrefix: contentHash.slice(0, 12),
      })

      // 1. Hygiene + truncate
      const sanitized = sanitize(listing)
      const { result: hygienedListing, truncated } = truncate(sanitized)
      if (truncated) {
        yield* Effect.logInfo("[tailor] listing truncated from middle", {
          originalLength: sanitized.length,
          truncatedLength: hygienedListing.length,
        })
      }

      // 2. Quota check
      yield* this.quotaService.tryConsume(subject)

      // 3. Stage 1: Cleanup
      const stage1Result = yield* runCleanupStage(
        this.openRouterClient,
        hygienedListing,
        this.env.openRouterCleanupModel,
      ).pipe(
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
        model: stage1Result.meta.model,
        tokens: stage1Result.meta.tokens,
        latencyMs: stage1Result.meta.latencyMs,
      })

      const cleanedListing = stage1Result.cleanup.cleanedListing
      const jobTitle = stage1Result.cleanup.jobTitle
      const company = stage1Result.cleanup.company

      // 4. Stage 2: Tailor
      const stage2StartTime = yield* Clock.currentTimeMillis
      const tailorMessages = buildTailorMessages(cleanedListing, content)
      const tailorResponseFormat = buildTailorResponseFormat()

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
            // Parse JSON
            return Effect.try({
              try: () => JSON.parse(response.content) as TailorEdits,
              catch: (error) =>
                new Services.TailorService.TailorError({
                  message: "Stage 2 (tailor) output was not valid JSON",
                  error: Utils.errorToJson(error),
                }),
            }).pipe(
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

      // 5. Validation pipeline
      let edits = stage2Result.edits

      // 5a. ID resolution
      const idResolution = resolveIds(edits, content)
      edits = idResolution.edits
      if (idResolution.dropped.length > 0) {
        yield* Effect.logInfo("[tailor] dropped edits with unknown IDs", {
          dropped: idResolution.dropped,
        })
      }

      // 5b. Tag invariance
      const tagCheck = checkTagInvariance(edits, content)
      edits = tagCheck.edits
      if (tagCheck.rejected.length > 0) {
        yield* Effect.logWarning("[tailor] rejected tag groups (length/membership violation)", {
          rejected: tagCheck.rejected,
        })
      }

      // 5c. Fabrication guard
      const fabricationCheck = checkFabrication(edits, content, cleanedListing)
      edits = fabricationCheck.edits
      if (fabricationCheck.dropped.length > 0) {
        yield* Effect.logWarning("[tailor] dropped edits with fabricated content", {
          dropped: fabricationCheck.dropped,
        })
      }

      // 5d. Evidence guard
      edits = checkEvidence(edits, cleanedListing)

      // 5e. Merge
      const mergedContent = mergeEdits(content, edits)

      // 5f. Keyword coverage (server-side)
      const coverage = computeKeywordCoverage(edits.fit.keywordCoverage.required, mergedContent)

      // 5g. Merge-delta assertion (replace-only) — FAIL on non-replace ops
      const patch = ResumeContent.ContentDiffer.diff(content, mergedContent)
      const nonReplaceOps = patch.filter((op) => op.op !== "replace")
      if (nonReplaceOps.length > 0) {
        yield* Effect.logWarning("[tailor] merge delta contains non-replace ops, failing", {
          ops: nonReplaceOps.map((op) => op.op),
        })
        return yield* Effect.fail(
          new Services.TailorService.TailorError({
            message: `Merge-delta guard: model produced non-replace JSON-Patch ops [${
              nonReplaceOps.map((op) => op.op).join(", ")
            }] violating the replace-only contract`,
            error: null,
          }),
        )
      }

      // 6. Build final result
      const fitReport = {
        ...edits.fit,
        keywordCoverage: {
          required: edits.fit.keywordCoverage.required,
          matched: coverage.matched,
          missing: coverage.missing,
        },
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
          stage1: stage1Result.meta,
          stage2: stage2Meta,
          degraded: false,
          cacheHit: false,
          contentHash,
          listingHash,
          promptVersion,
          schemaVersion,
        },
      }
    }).pipe(
      Effect.annotateLogs({
        subject,
        promptVersion,
        schemaVersion,
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
