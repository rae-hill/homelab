import { Layer } from "effect"
import { OpenRouterClientServiceLive } from "../layers/openrouter-client-service.js"
import { PromptSanitizationServiceLive } from "../layers/prompt-sanitization-service.js"
import { ResumeContentMergeServiceLive } from "../layers/resume-content-merge-service.js"
import { ResumeListingExtractionServiceLive } from "../layers/resume-listing-extraction-service.js"
import { ResumePromptConfigServiceLive } from "../layers/resume-prompt-config-service.js"
import { ResumeTailorValidationServiceLive } from "../layers/resume-tailor-validation-service.js"
import { TailorQuotaServiceLive } from "../layers/tailor-quota-service.js"
import { TailorServiceLive } from "../layers/tailor-service.js"

/**
 * Resume-tailoring domain aggregate.
 *
 * Composes the full service pipeline:
 * - TailorServiceLive (orchestrator)
 * - OpenRouterClientServiceLive (HTTP client)
 * - TailorQuotaServiceLive (rate limiting)
 * - PromptSanitizationServiceLive (input hygiene)
 * - ResumeListingExtractionServiceLive (stage 1 cleanup)
 * - ResumePromptConfigServiceLive (prompt builders + version metadata)
 * - ResumeTailorValidationServiceLive (semantic validation)
 * - ResumeContentMergeServiceLive (mechanical merge + structural guard)
 */
export const Aggregate = TailorServiceLive.pipe(
  Layer.provide(OpenRouterClientServiceLive),
  Layer.provide(TailorQuotaServiceLive),
  Layer.provide(PromptSanitizationServiceLive),
  Layer.provide(ResumeListingExtractionServiceLive),
  Layer.provide(ResumePromptConfigServiceLive),
  Layer.provide(ResumeTailorValidationServiceLive),
  Layer.provide(ResumeContentMergeServiceLive),
)
