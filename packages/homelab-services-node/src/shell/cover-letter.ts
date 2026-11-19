import { Layer } from "effect"
import { CachedResumeListingExtractionServiceLive } from "../layers/cached-resume-listing-extraction-service.js"
import { CoverLetterPromptConfigServiceLive } from "../layers/cover-letter-prompt-config-service.js"
import { CoverLetterServiceLive } from "../layers/cover-letter-service.js"
import { CoverLetterTemplateServiceLive } from "../layers/cover-letter-template-service.js"
import { DocumentRenderingServiceTypstLive } from "../layers/document-rendering-service-typst.js"
import { HashingServiceSha256Live } from "../layers/hashing-service-sha256.js"
import { OpenRouterClientServiceLive } from "../layers/openrouter-client-service.js"
import { PromptSanitizationServiceLive } from "../layers/prompt-sanitization-service.js"
import { ResumePromptConfigServiceLive } from "../layers/resume-prompt-config-service.js"

/**
 * Cover-letter domain aggregate (docs/cover-letter-generator).
 *
 * Composes the full pipeline:
 * - CoverLetterServiceLive (orchestrator)
 * - CachedResumeListingExtractionServiceLive (stage 1 cleanup — SAME decorator as the
 *   tailor aggregate, so the shared cache makes the tailor→letter workflow a stage-1 hit)
 * - CoverLetterPromptConfigServiceLive (generation prompt + exemplars)
 * - OpenRouterClientServiceLive (HTTP client)
 * - PromptSanitizationServiceLive (input hygiene)
 * - HashingServiceSha256Live (listingHash / cache key)
 * - CoverLetterTemplateServiceLive (letter → Typst render request)
 * - DocumentRenderingServiceTypstLive (typst.ts NodeCompiler → PDF)
 *
 * RIn (deliberately NOT provided here): TailorQuotaService and ListingCleanupCacheService
 * must be SINGLE INSTANCES shared with the tailor aggregate — main.ts provides them once
 * over `Layer.merge(Tailor.Aggregate, CoverLetter.Aggregate)` (CL-D6/CL-D7). Env,
 * FileSystem and HttpClient come from main.ts's global provides.
 *
 * GOTCHA (T15): a flat `Layer.provide` chain does NOT feed earlier provides into LATER
 * providers' own requirements — the extraction decorator needs the OpenRouter client +
 * prompt config + hashing ITSELF, so its deps are nested explicitly. Effect memoizes
 * layer identity, so repeated stateless layers are built once per runtime.
 */
const ListingExtraction = CachedResumeListingExtractionServiceLive.pipe(
  Layer.provide(OpenRouterClientServiceLive),
  Layer.provide(ResumePromptConfigServiceLive),
  Layer.provide(HashingServiceSha256Live),
)

export const Aggregate = CoverLetterServiceLive.pipe(
  Layer.provide(ListingExtraction),
  Layer.provide(OpenRouterClientServiceLive),
  Layer.provide(CoverLetterPromptConfigServiceLive),
  Layer.provide(PromptSanitizationServiceLive),
  Layer.provide(HashingServiceSha256Live),
  Layer.provide(CoverLetterTemplateServiceLive),
  Layer.provide(DocumentRenderingServiceTypstLive),
)
