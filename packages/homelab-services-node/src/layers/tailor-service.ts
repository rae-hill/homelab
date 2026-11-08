import { Clock, Duration, Effect, Layer } from "effect"
import { Config, Services } from "homelab-services"
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
      )

      // If stage 1 failed (meta is null), degrade immediately
      if (stage1Result.meta === null) {
        yield* Effect.logWarning("[tailor] stage 1 failed, returning degraded result")
        return this.buildDegradedResult(
          content,
          baseVersion,
          stage1Result.cleanup.jobTitle,
          stage1Result.cleanup.company,
          listingHash,
          contentHash,
          null,
        )
      }

      const cleanedListing = stage1Result.cleanup.cleanedListing
      const jobTitle = stage1Result.cleanup.jobTitle
      const company = stage1Result.cleanup.company

      // 4. Stage 2: Tailor
      const stage2StartTime = yield* Clock.currentTimeMillis
      const tailorMessages = buildTailorMessages(cleanedListing, content)
      const tailorResponseFormat = buildTailorResponseFormat()

      type Stage2Result =
        | { edits: TailorEdits; tokens: { input: number; output: number }; latencyMs: number; degraded?: false }
        | { edits: null; error: unknown; degraded: true }

      const stage2Result: Stage2Result = yield* this.openRouterClient
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
                  message: "Failed to parse stage 2 output as JSON",
                  error,
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
          Effect.catch((error) => {
            // Stage 2 failed — degrade
            return Effect.succeed({
              edits: null,
              error,
              degraded: true,
            } as Stage2Result)
          }),
        )

      // If stage 2 failed, return degraded result
      if (stage2Result.degraded) {
        yield* Effect.logWarning("[tailor] stage 2 failed, returning degraded result", {
          error: stage2Result.error,
        })

        return this.buildDegradedResult(
          content,
          baseVersion,
          jobTitle,
          company,
          listingHash,
          contentHash,
          stage1Result.meta,
        )
      }

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

      // 5g. Merge-delta assertion (replace-only)
      const patch = ResumeContent.ContentDiffer.diff(content, mergedContent)
      const hasNonReplaceOps = patch.some((op) => op.op !== "replace")
      if (hasNonReplaceOps) {
        yield* Effect.logWarning("[tailor] merge delta contains non-replace ops, degrading", {
          ops: patch.map((op) => op.op),
        })
        return this.buildDegradedResult(
          content,
          baseVersion,
          jobTitle,
          company,
          listingHash,
          contentHash,
          stage1Result.meta,
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
        // Let TailorQuotaExceeded propagate as a typed error (don't degrade)
        if (error instanceof Services.TailorService.TailorQuotaExceeded) {
          return Effect.fail(error)
        }
        // Degrade for all other errors
        return Effect.flatMap(
          Effect.logError("[tailor] pipeline error, degrading", { error }),
          () =>
            Effect.succeed(
              this.buildDegradedResult(
                content,
                baseVersion,
                "Unknown Role",
                null,
                createHash("sha256").update(listing).digest("hex"),
                createHash("sha256").update(JSON.stringify(content)).digest("hex"),
                null,
              ),
            ),
        )
      }),
    )
  }

  private buildDegradedResult(
    content: ResumeContentType.ContentState,
    baseVersion: string,
    jobTitle: string,
    company: string | null,
    listingHash: string,
    contentHash: string,
    stage1Meta: { model: string; tokens: { input: number; output: number }; latencyMs: number } | null,
  ): Services.TailorService.TailorResult {
    return {
      jobTitle,
      company,
      content,
      baseVersion,
      fit: {
        verdict: "weak",
        summary: "Tailoring degraded due to pipeline failure. Review the listing manually.",
        tips: [
          {
            category: "listing-quality",
            severity: "info",
            title: "Manual review recommended",
            detail: "The AI pipeline encountered an issue. Please review the listing and content manually.",
            evidence: "",
          },
        ],
        keywordCoverage: {
          required: [],
          matched: [],
          missing: [],
        },
      },
      meta: {
        stage1: stage1Meta,
        stage2: null,
        degraded: true,
        cacheHit: false,
        contentHash,
        listingHash,
        promptVersion,
        schemaVersion,
      },
    }
  }
}
