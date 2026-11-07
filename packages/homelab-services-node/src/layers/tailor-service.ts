import { Effect, Layer } from "effect"
import { Services } from "homelab-services"

/**
 * PLACEHOLDER until T4 (doc 02). The real `TailorService` Live layer composes the
 * OpenRouter client, cleanup/tailor stages, validation pipeline, and quota; this stub
 * only satisfies the dependency graph so `main.ts` typechecks and the endpoint stays
 * dark-safe (fails with a 500 "not implemented") until the pipeline lands.
 */
export const TailorServiceLive = Layer.succeed(Services.TailorService.TailorService, {
  tailorResume: () =>
    Effect.fail(
      new Services.TailorService.TailorError({
        message: "resume tailoring is not implemented yet (tailor T4)",
        error: null,
      }),
    ),
})
