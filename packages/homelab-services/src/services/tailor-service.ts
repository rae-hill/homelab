import { Context, Data, Effect } from "effect"
import type { ResumeContent } from "shared"
import type { ResumeTailorResponse, TailorValidationPolicy } from "../schemas/resume-tailor.js"

export const TailorServiceId = "homelab-api/services/tailor/TailorService"

/** Raised when the two-stage AI pipeline cannot complete (provider dead, unparseable output after retry, patch-apply throw). */
export class TailorError extends Data.TaggedError("TailorError")<{
  readonly message: string
  readonly error: unknown
}> {}

/**
 * Model-facing edits type (structural interface — runtime-free, declared here in homelab-services
 * to avoid the forbidden homelab-services → homelab-services-node import direction). The impl
 * assignment in homelab-services-node is the compile-time conformance gate: the node wire-schema's
 * inferred Type must structurally match this interface.
 */
export interface TailorEdits {
  readonly headline: string | null
  readonly summary: string | null
  readonly bullets: ReadonlyArray<{
    readonly entryId: string
    readonly bulletId: string
    readonly text: string
    readonly rationale: string
  }>
  readonly entryDescriptions: ReadonlyArray<{
    readonly entryId: string
    readonly description: string
  }>
  readonly hiddenBullets: ReadonlyArray<{
    readonly entryId: string
    readonly bulletId: string
    readonly rationale: string
  }>
  readonly addedBullets: ReadonlyArray<{
    readonly entryId: string
    readonly text: string
    readonly rationale: string
  }>
  readonly tagGroups: ReadonlyArray<{
    readonly entryId: string
    readonly tags: ReadonlyArray<string>
  }>
  readonly fit: {
    readonly verdict: "strong" | "partial" | "weak"
    readonly summary: string
    readonly tips: ReadonlyArray<{
      readonly category:
        | "requirements-inflation"
        | "buried-hard-gate"
        | "title-scope-mismatch"
        | "logistics"
        | "employment-form"
        | "compensation"
        | "screening-risk"
        | "process"
        | "listing-quality"
      readonly severity: "info" | "caution" | "blocker"
      readonly title: string
      readonly detail: string
      readonly evidence: string
    }>
    readonly keywordCoverage: {
      readonly required: ReadonlyArray<string>
    }
  }
}

/**
 * Raised when the caller's per-subject daily tailor quota is exhausted — a SEPARATE typed
 * failure from `TailorError` so the handler maps it to a 4xx (user-facing spend cap) while
 * `TailorError` maps to 500.
 */
export class TailorQuotaExceeded extends Data.TaggedError("TailorQuotaExceeded")<{
  readonly retryAfterSeconds: number
}> {}

/**
 * Type-level response of the tailor pipeline. On the wire `content` is a base64 JSON Patch
 * (`ContentPatchBase64`), but at the type level it is a full `ContentState` — the HttpApi
 * success codec encodes it at the edge; the service never hand-diffs or hand-base64s.
 */
export type TailorResult = ResumeTailorResponse

export interface TailorServiceDef {
  /**
   * Run the two-stage tailoring pipeline for one request.
   *
   * - `subject`: caller's stable identifier (identity `identifier` — email for OIDC
   *   identities), forwarded by the handler for the per-subject daily quota.
   * - `listing`: raw pasted job-listing text; the service does hygiene/truncation itself.
   * - `content`: the user's current content — already decoded from the wire patch to a
   *   `ContentState` by the payload codec at the HttpApi edge.
   * - `baseVersion`: already validated against `CONTENT_DEFAULTS_VERSION` by the handler.
   * - `policy`: optional validation policy (defaults to permissive: enabled=false).
   *
   * Pipeline failures are typed `TailorError` failures (mapped to 500 by the handler)
   * with upstream causes rendered into `message`; quota stays a separate 400. Full
   * pipeline contract: doc 02.
   */
  readonly tailorResume: (
    subject: string,
    listing: string,
    content: ResumeContent.ContentState,
    baseVersion: string,
    policy?: TailorValidationPolicy,
  ) => Effect.Effect<TailorResult, TailorError | TailorQuotaExceeded>
}

export class TailorService extends Context.Service<TailorService, TailorServiceDef>()(TailorServiceId) {
}

/** {@inheritDoc TailorServiceDef.tailorResume} */
export const tailorResume = Effect.fn("TailorService.tailorResume")(function*(
  ...params: Parameters<TailorServiceDef["tailorResume"]>
): Effect.fn.Return<TailorResult, TailorError | TailorQuotaExceeded, TailorService> {
  const svc = yield* TailorService
  return yield* svc.tailorResume(...params)
})
