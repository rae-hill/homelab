import { Clock, Duration, Effect, Layer } from "effect"
import { Config, Services, Utils } from "homelab-services"

/**
 * Listing extraction service implementation. Absorbs cleanup.ts logic (stage 1).
 *
 * Depends on OpenRouterClientService + ResumePromptConfigService (for messages + response format).
 * Uses Clock.currentTimeMillis for latency measurement.
 *
 * Errors are typed (no chain strings — T12 semantics). Parse failures become ListingExtractionError
 * with error: Utils.errorToJson(raw).
 */
export const makeResumeListingExtractionService = () =>
  Layer.effect(
    Services.ResumeListingExtractionService.ResumeListingExtractionService,
    Effect.gen(function*() {
      const openRouterClient = yield* Services.OpenRouterClientService.OpenRouterClientService
      const promptConfig = yield* Services.ResumePromptConfigService.ResumePromptConfigService
      const env = yield* Config.Env.Env

      return {
        extract: (args: { listing: string }) =>
          Effect.gen(function*() {
            const startTime = yield* Clock.currentTimeMillis

            // Build messages + response format from prompt config service
            const messages = promptConfig.buildCleanupMessages({ listing: args.listing })
            const responseFormat = promptConfig.buildCleanupResponseFormat()

            // Call OpenRouter
            const response = yield* openRouterClient.chat({
              model: env.openRouterCleanupModel,
              messages,
              responseFormat,
              maxTokens: 4000,
              timeout: Duration.seconds(60),
            })

            // Parse JSON response
            const parsed = yield* Effect.try({
              try: () => JSON.parse(response.content),
              catch: (error) => error,
            }).pipe(
              Effect.mapError((error) =>
                new Services.ResumeListingExtractionService.ListingExtractionError({
                  message: "Stage 1 (cleanup) output was not valid JSON",
                  error: Utils.errorToJson(error),
                })
              ),
            )

            const endTime = yield* Clock.currentTimeMillis

            yield* Effect.logInfo("Stage 1 (cleanup) succeeded", {
              model: env.openRouterCleanupModel,
              tokens: { input: response.usage.promptTokens, output: response.usage.completionTokens },
              latencyMs: endTime - startTime,
            })

            return {
              cleanedListing: parsed.cleanedListing,
              jobTitle: parsed.jobTitle,
              company: parsed.company,
              stage: {
                model: env.openRouterCleanupModel,
                promptTokens: response.usage.promptTokens,
                completionTokens: response.usage.completionTokens,
                latencyMs: endTime - startTime,
              },
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
      }
    }),
  )

export const ResumeListingExtractionServiceLive = makeResumeListingExtractionService()
