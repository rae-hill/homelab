import { Clock, Duration, Effect, Layer, Schema } from "effect"
import { Config, Services, Utils } from "homelab-services"
import { CleanupResponse } from "../schemas/Tailoring.js"

/**
 * Listing extraction service implementation. Absorbs cleanup.ts logic (stage 1).
 *
 * Depends on OpenRouterClientService + ResumePromptConfigService (for messages + response format).
 * Uses Clock.currentTimeMillis for latency measurement.
 *
 * Errors are typed (no chain strings — T12 semantics). Parse failures become ListingExtractionError
 * with error: Utils.errorToJson(raw).
 */

/** Dependencies of the raw extraction impl — exposed so the cache decorator can build an inner instance. */
export interface ResumeListingExtractionDeps {
  readonly openRouterClient: Services.OpenRouterClientService.OpenRouterClientServiceDef
  readonly promptConfig: Services.ResumePromptConfigService.ResumePromptConfigServiceDef
  readonly env: typeof Config.Env.Env.Service
}

/** Build the raw (uncached) stage-1 impl from resolved dependencies. */
export const makeResumeListingExtractionServiceImpl = (
  deps: ResumeListingExtractionDeps,
): Services.ResumeListingExtractionService.ResumeListingExtractionServiceDef => ({
  extract: (args: { listing: string }) =>
    Effect.gen(function*() {
      const startTime = yield* Clock.currentTimeMillis

      // Build messages + response format from prompt config service
      const messages = deps.promptConfig.buildCleanupMessages({ listing: args.listing })
      const responseFormat = deps.promptConfig.buildCleanupResponseFormat()

      // Call OpenRouter
      const response = yield* deps.openRouterClient.chat({
        model: deps.env.openRouterCleanupModel,
        messages,
        responseFormat,
        maxTokens: 4000,
        timeout: Duration.seconds(60),
      })

      // Parse JSON response via schema
      const parsed = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(CleanupResponse),
      )(response.content).pipe(
        Effect.mapError((error) =>
          new Services.ResumeListingExtractionService.ListingExtractionError({
            message: "Stage 1 (cleanup) output was not valid JSON",
            error: Utils.errorToJson(error),
          })
        ),
      )

      const endTime = yield* Clock.currentTimeMillis

      yield* Effect.logInfo("Stage 1 (cleanup) succeeded", {
        model: deps.env.openRouterCleanupModel,
        tokens: { input: response.usage.promptTokens, output: response.usage.completionTokens },
        latencyMs: endTime - startTime,
      })

      return {
        cleanedListing: parsed.cleanedListing,
        jobTitle: parsed.jobTitle,
        company: parsed.company,
        stage: {
          model: deps.env.openRouterCleanupModel,
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          latencyMs: endTime - startTime,
        },
        fromCache: false,
      }
    }).pipe(
      Effect.mapError((error) => {
        if (error instanceof Services.ResumeListingExtractionService.ListingExtractionError) {
          return error
        }
        return new Services.ResumeListingExtractionService.ListingExtractionError({
          message: "Stage 1 (cleanup) failed",
          error: Utils.errorToJson(error),
        })
      }),
    ),
})

export const makeResumeListingExtractionService = () =>
  Layer.effect(
    Services.ResumeListingExtractionService.ResumeListingExtractionService,
    Effect.gen(function*() {
      const openRouterClient = yield* Services.OpenRouterClientService.OpenRouterClientService
      const promptConfig = yield* Services.ResumePromptConfigService.ResumePromptConfigService
      const env = yield* Config.Env.Env

      return makeResumeListingExtractionServiceImpl({ openRouterClient, promptConfig, env })
    }),
  )

export const ResumeListingExtractionServiceLive = makeResumeListingExtractionService()
