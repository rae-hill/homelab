import { Layer } from "effect"
import { CachedResumeListingExtractionServiceLive } from "../layers/cached-resume-listing-extraction-service.js"
import { HashingServiceSha256Live } from "../layers/hashing-service-sha256.js"
import { OpenRouterClientServiceLive } from "../layers/openrouter-client-service.js"
import { PromptSanitizationServiceLive } from "../layers/prompt-sanitization-service.js"
import { ResumeContentMergeServiceLive } from "../layers/resume-content-merge-service.js"
import { ResumePromptConfigServiceLive } from "../layers/resume-prompt-config-service.js"
import { ResumeTailorValidationServiceLive } from "../layers/resume-tailor-validation-service.js"
import { TailorServiceLive } from "../layers/tailor-service.js"

/**
 * Resume-tailoring domain aggregate.
 *
 * Composes the full service pipeline:
 * - TailorServiceLive (orchestrator)
 * - CachedResumeListingExtractionServiceLive (stage 1 cleanup, cache decorator — CL-D6)
 * - OpenRouterClientServiceLive (HTTP client)
 * - PromptSanitizationServiceLive (input hygiene)
 * - ResumePromptConfigServiceLive (prompt builders + version metadata)
 * - ResumeTailorValidationServiceLive (semantic validation)
 * - ResumeContentMergeServiceLive (mechanical merge + structural guard)
 * - HashingServiceSha256Live (listingHash/contentHash + cache key)
 *
 * RIn (deliberately NOT provided here): TailorQuotaService and ListingCleanupCacheService
 * must be SINGLE INSTANCES shared with the cover-letter aggregate — main.ts provides them
 * once over `Layer.merge(Tailor.Aggregate, CoverLetter.Aggregate)` (CL-D6/CL-D7). Env,
 * FileSystem and HttpClient come from main.ts's global provides as before.
 *
 * GOTCHA (T15): a flat `Layer.provide` chain does NOT feed earlier provides into
 * LATER providers' own requirements — the extraction decorator needs the OpenRouter
 * client + prompt config + hashing ITSELF, so its deps are nested explicitly
 * (otherwise `OpenRouterClientService` leaks into the Aggregate's RIn and
 * main.ts's `Layer.launch` fails typecheck). Effect memoizes layer identity, so
 * the repeated `OpenRouterClientServiceLive` is built once per runtime.
 */
const ListingExtraction = CachedResumeListingExtractionServiceLive.pipe(
  Layer.provide(OpenRouterClientServiceLive),
  Layer.provide(ResumePromptConfigServiceLive),
  Layer.provide(HashingServiceSha256Live),
)

export const Aggregate = TailorServiceLive.pipe(
  Layer.provide(ListingExtraction),
  Layer.provide(OpenRouterClientServiceLive),
  Layer.provide(ResumePromptConfigServiceLive),
  Layer.provide(PromptSanitizationServiceLive),
  Layer.provide(ResumeTailorValidationServiceLive),
  Layer.provide(ResumeContentMergeServiceLive),
  Layer.provide(HashingServiceSha256Live),
)
