import { Layer } from "effect"
import { HashingServiceSha256Live } from "../layers/hashing-service-sha256.js"
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
 *
 * GOTCHA (T15): a flat `Layer.provide` chain does NOT feed earlier provides into
 * LATER providers' own requirements — `ResumeListingExtractionServiceLive` needs
 * the OpenRouter client + prompt config ITSELF, so its deps are nested explicitly
 * (otherwise `OpenRouterClientService` leaks into the Aggregate's RIn and
 * main.ts's `Layer.launch` fails typecheck). Effect memoizes layer identity, so
 * the repeated `OpenRouterClientServiceLive` is built once per runtime.
 */
const ListingExtraction = ResumeListingExtractionServiceLive.pipe(
  Layer.provide(OpenRouterClientServiceLive),
  Layer.provide(ResumePromptConfigServiceLive),
)

export const Aggregate = TailorServiceLive.pipe(
  Layer.provide(ListingExtraction),
  Layer.provide(OpenRouterClientServiceLive),
  Layer.provide(ResumePromptConfigServiceLive),
  Layer.provide(TailorQuotaServiceLive),
  Layer.provide(PromptSanitizationServiceLive),
  Layer.provide(ResumeTailorValidationServiceLive),
  Layer.provide(ResumeContentMergeServiceLive),
  Layer.provide(HashingServiceSha256Live),
)
