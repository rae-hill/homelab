import { Context, Data, Effect, type JsonPatch } from "effect"
import type { ResumeContent } from "shared"
import type { TailorChange, TailorValidationPolicy } from "../schemas/resume-tailor.js"
import type { TailorEdits } from "./tailor-service.js"

export const ResumeContentMergeServiceId = "homelab-api/services/tailor/ResumeContentMergeService"

/** Raised when merge fails (delta guard violation, schema-decode failure). */
export class ContentMergeError extends Data.TaggedError("ContentMergeError")<{
  readonly message: string
  readonly error: unknown
}> {}

export interface ResumeContentMergeServiceDef {
  /**
   * Mechanical merge + structural guard over the ContentDiffer delta (doc 07 §B.5).
   *
   * Merge mechanics: ID-addressed domain mutation (headline→blurb, summary→aboutMe, bullet text,
   * visible:false hides, descriptions, tag reorder; T16 appends addedBullets). Deep copy via
   * structuredClone (replaces the JSON.parse(JSON.stringify()) idiom, M4-adjacent).
   *
   * Structural guard (policy-driven):
   * - merged output must decode as ContentState
   * - replace: always allowed
   * - add: allowed iff !policy.enabled
   * - remove: ALWAYS rejected in v2
   * - enabled=true → replace-only (exact v1 strictness)
   *
   * Changes enrichment: for each delta op, look up previous at its path in the REQUEST content;
   * adds carry previous: null.
   */
  readonly merge: (args: {
    content: ResumeContent.ContentState
    edits: TailorEdits
    policy: TailorValidationPolicy
  }) => Effect.Effect<{
    merged: ResumeContent.ContentState
    delta: JsonPatch.JsonPatch
    changes: ReadonlyArray<TailorChange>
  }, ContentMergeError>
}

export class ResumeContentMergeService
  extends Context.Service<ResumeContentMergeService, ResumeContentMergeServiceDef>()(ResumeContentMergeServiceId)
{}

/** {@inheritDoc ResumeContentMergeServiceDef.merge} */
export const merge = Effect.fn("ResumeContentMergeService.merge")(function*(
  ...params: Parameters<ResumeContentMergeServiceDef["merge"]>
): Effect.fn.Return<
  {
    merged: ResumeContent.ContentState
    delta: JsonPatch.JsonPatch
    changes: ReadonlyArray<TailorChange>
  },
  ContentMergeError,
  ResumeContentMergeService
> {
  const svc = yield* ResumeContentMergeService
  return yield* svc.merge(...params)
})
