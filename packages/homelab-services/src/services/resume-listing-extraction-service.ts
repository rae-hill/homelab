import { Context, Data, Effect } from "effect"

export const ResumeListingExtractionServiceId = "homelab-api/services/tailor/ResumeListingExtractionService"

/** Raised when stage 1 cleanup/extraction fails. */
export class ListingExtractionError extends Data.TaggedError("ListingExtractionError")<{
  readonly message: string
  readonly error: unknown
}> {}

/**
 * Stage 1 result: cleaned listing + extracted metadata.
 * Self-contained structural type (no node imports).
 *
 * `fromCache` is true when the result was served by the ListingCleanupCacheService decorator
 * (docs/cover-letter-generator/01 §A) instead of a live stage-1 call; `stage` then reports the
 * ORIGINAL call's meta. The raw impl always returns false.
 */
export interface ExtractionResult {
  readonly cleanedListing: string
  readonly jobTitle: string
  readonly company: string | null
  readonly stage: {
    readonly model: string
    readonly promptTokens: number
    readonly completionTokens: number
    readonly latencyMs: number
  }
  readonly fromCache: boolean
}

export interface ResumeListingExtractionServiceDef {
  /**
   * Run stage 1 cleanup: extractive-only deletion of cruft (EEO, benefits, legal, nav)
   * and extract jobTitle/company. Uses the cheap cleanup model.
   *
   * Impl depends on OpenRouterClientService + ResumePromptConfigService.
   * Errors are typed (no chain strings — T12 semantics).
   */
  readonly extract: (args: {
    listing: string
  }) => Effect.Effect<ExtractionResult, ListingExtractionError>
}

export class ResumeListingExtractionService
  extends Context.Service<ResumeListingExtractionService, ResumeListingExtractionServiceDef>()(
    ResumeListingExtractionServiceId,
  )
{}

/** {@inheritDoc ResumeListingExtractionServiceDef.extract} */
export const extract = Effect.fn("ResumeListingExtractionService.extract")(function*(
  ...params: Parameters<ResumeListingExtractionServiceDef["extract"]>
): Effect.fn.Return<ExtractionResult, ListingExtractionError, ResumeListingExtractionService> {
  const svc = yield* ResumeListingExtractionService
  return yield* svc.extract(...params)
})
