import { Clock, Duration, Effect } from "effect"
import { Services, Utils } from "homelab-services"
import { buildCleanupMessages, buildCleanupResponseFormat } from "./prompts.js"
import type { CleanupResponse } from "./wire-schema.js"

/**
 * Stage 1: Listing cleanup pipeline.
 *
 * Runs the cheap model to extractive-only delete cruft (EEO, benefits, legal, nav)
 * and extract jobTitle/company. On failure, propagates typed errors.
 */

/**
 * Run stage 1 cleanup.
 *
 * @param client - OpenRouterClientService for making the API call
 * @param listing - raw listing text (already hygiene'd + truncated by caller)
 * @param cleanupModel - model slug for the cheap cleanup model
 * @returns CleanupResponse + stage metadata, or typed error on failure
 */
export const runCleanupStage = (
  client: Services.OpenRouterClientService.OpenRouterClientServiceDef,
  listing: string,
  cleanupModel: string,
): Effect.Effect<
  {
    cleanup: CleanupResponse
    meta: {
      model: string
      tokens: { input: number; output: number }
      latencyMs: number
    }
  },
  Services.OpenRouterClientService.OpenRouterError | Services.TailorService.TailorError
> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((startTime) => {
      const messages = buildCleanupMessages(listing)
      const responseFormat = buildCleanupResponseFormat()

      return client
        .chat({
          model: cleanupModel,
          messages,
          responseFormat,
          maxTokens: 4000,
          timeout: Duration.seconds(60),
        })
        .pipe(
          Effect.flatMap((response) =>
            Clock.currentTimeMillis.pipe(
              Effect.flatMap((endTime) =>
                // Parse the JSON content
                Effect.try({
                  try: () => JSON.parse(response.content) as CleanupResponse,
                  catch: (error) => error,
                }).pipe(
                  Effect.map((parsed) => ({
                    cleanup: parsed,
                    meta: {
                      model: cleanupModel,
                      tokens: {
                        input: response.usage.promptTokens,
                        output: response.usage.completionTokens,
                      },
                      latencyMs: endTime - startTime,
                    },
                  })),
                  Effect.catch((parseErr) =>
                    Effect.fail(
                      new Services.TailorService.TailorError({
                        message: "Stage 1 (cleanup) output was not valid JSON",
                        error: Utils.errorToJson(parseErr),
                      }),
                    )
                  ),
                )
              ),
            )
          ),
          Effect.flatMap((result) =>
            Effect.logInfo("Stage 1 (cleanup) succeeded", {
              model: result.meta.model,
              tokens: result.meta.tokens,
              latencyMs: result.meta.latencyMs,
            }).pipe(Effect.map(() => result))
          ),
          Effect.catch((error) =>
            Effect.flatMap(
              Effect.logError("Stage 1 (cleanup) failed"),
              () => Effect.fail(error),
            )
          ),
        )
    }),
  )
