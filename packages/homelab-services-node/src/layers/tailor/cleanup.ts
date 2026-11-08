import { Clock, Duration, Effect } from "effect"
import type { Services } from "homelab-services"
import { sanitize, truncate } from "./hygiene.js"
import { buildCleanupMessages, buildCleanupResponseFormat } from "./prompts.js"
import type { CleanupResponse } from "./wire-schema.js"

/**
 * Stage 1: Listing cleanup pipeline.
 *
 * Runs the cheap model to extractive-only delete cruft (EEO, benefits, legal, nav)
 * and extract jobTitle/company. On failure, falls back to hygiene'd raw listing.
 */

/**
 * Run stage 1 cleanup.
 *
 * @param client - OpenRouterClientService for making the API call
 * @param listing - raw listing text (already hygiene'd + truncated by caller)
 * @param cleanupModel - model slug for the cheap cleanup model
 * @returns CleanupResponse + stage metadata
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
    } | null
  },
  never
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
                  Effect.catch(() => {
                    // Decode failure — fall back to defaults
                    return Effect.succeed(fallbackCleanup(listing))
                  }),
                )
              ),
            )
          ),
          Effect.catch(() => {
            // API call failed — fall back to defaults
            return Effect.succeed(fallbackCleanup(listing))
          }),
        )
    }),
  )

/**
 * Fallback cleanup: return hygiene'd listing + extract first non-empty line as jobTitle.
 */
const fallbackCleanup = (listing: string) => {
  const sanitized = sanitize(listing)
  const truncated = truncate(sanitized)
  const lines = truncated.result.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
  const jobTitle = lines[0]?.slice(0, 100) ?? "Unknown Role"

  return {
    cleanup: {
      cleanedListing: truncated.result,
      jobTitle,
      company: null,
    },
    meta: null,
  }
}
