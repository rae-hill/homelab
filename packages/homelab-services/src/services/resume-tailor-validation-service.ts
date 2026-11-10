import { Context, Data, Effect } from "effect"
import type { ResumeContent } from "shared"
import type { TailorValidationPolicy } from "../schemas/resume-tailor.js"
import type { TailorEdits } from "./tailor-service.js"

export const ResumeTailorValidationServiceId = "homelab-api/services/tailor/ResumeTailorValidationService"

/** Raised when semantic validation of model edits fails. */
export class TailorValidationError extends Data.TaggedError("TailorValidationError")<{
  readonly message: string
  readonly error: unknown
}> {}

export interface ResumeTailorValidationServiceDef {
  /**
   * Validate and filter model edits against the policy.
   *
   * Policy-driven semantics (doc 07 §B.1):
   * - Unknown-ID edits ALWAYS dropped (merge mechanics, not policy)
   * - enabled=false (default) → skip fabrication/evidence/tag checks entirely
   * - enabled=true → v1 behaviors: fabrication check iff rejectFabricatedMetrics,
   *   evidence downgrade iff groundTipsInListing, tag vocabulary check iff
   *   requireTagsGloballyAvailable
   *
   * Returns filtered edits + dropped list (for structured logging).
   */
  readonly validateEdits: (args: {
    content: ResumeContent.ContentState
    edits: TailorEdits
    cleanedListing: string
    policy: TailorValidationPolicy
  }) => Effect.Effect<{
    edits: TailorEdits
    dropped: ReadonlyArray<{ reason: string; detail: unknown }>
  }, TailorValidationError>

  /**
   * Compute keyword coverage: which required keywords appear in the merged content.
   * Case-insensitive substring matching against the full content JSON.
   */
  readonly computeKeywordCoverage: (args: {
    merged: ResumeContent.ContentState
    required: ReadonlyArray<string>
  }) => Effect.Effect<{
    matched: ReadonlyArray<string>
    missing: ReadonlyArray<string>
  }, TailorValidationError>
}

export class ResumeTailorValidationService
  extends Context.Service<ResumeTailorValidationService, ResumeTailorValidationServiceDef>()(
    ResumeTailorValidationServiceId,
  )
{}

/** {@inheritDoc ResumeTailorValidationServiceDef.validateEdits} */
export const validateEdits = Effect.fn("ResumeTailorValidationService.validateEdits")(function*(
  ...params: Parameters<ResumeTailorValidationServiceDef["validateEdits"]>
): Effect.fn.Return<
  {
    edits: TailorEdits
    dropped: ReadonlyArray<{ reason: string; detail: unknown }>
  },
  TailorValidationError,
  ResumeTailorValidationService
> {
  const svc = yield* ResumeTailorValidationService
  return yield* svc.validateEdits(...params)
})

/** {@inheritDoc ResumeTailorValidationServiceDef.computeKeywordCoverage} */
export const computeKeywordCoverage = Effect.fn("ResumeTailorValidationService.computeKeywordCoverage")(function*(
  ...params: Parameters<ResumeTailorValidationServiceDef["computeKeywordCoverage"]>
): Effect.fn.Return<
  {
    matched: ReadonlyArray<string>
    missing: ReadonlyArray<string>
  },
  TailorValidationError,
  ResumeTailorValidationService
> {
  const svc = yield* ResumeTailorValidationService
  return yield* svc.computeKeywordCoverage(...params)
})
