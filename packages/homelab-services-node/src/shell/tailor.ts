import { Layer } from "effect"
import { OpenRouterClientServiceLive } from "../layers/openrouter-client-service.js"
import { TailorQuotaServiceLive } from "../layers/tailor-quota-service.js"
import { TailorServiceLive } from "../layers/tailor-service.js"

/**
 * Resume-tailoring domain aggregate.
 *
 * Composes the full service pipeline: TailorServiceLive (orchestrator) +
 * OpenRouterClientServiceLive (HTTP client) + TailorQuotaServiceLive (rate limiting).
 */
export const Aggregate = TailorServiceLive.pipe(
  Layer.provide(OpenRouterClientServiceLive),
  Layer.provide(TailorQuotaServiceLive),
)
