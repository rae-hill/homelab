import { Context, Data, Effect } from "effect"
import type { ResumeContent } from "shared"
import type { TailorQuotaExceeded } from "./tailor-service.js"

export const CoverLetterServiceId = "homelab-api/services/cover-letter/CoverLetterService"

/** Raised when the cover-letter pipeline cannot complete (provider dead, unparseable output after retry, validation, render failure). */
export class CoverLetterError extends Data.TaggedError("CoverLetterError")<{
  readonly message: string
  readonly error: unknown
}> {}

export interface CoverLetterServiceDef {
  /**
   * Run the cover-letter pipeline for one request (docs/cover-letter-generator/01 §C).
   *
   * - `subject`: caller's stable identifier (identity `identifier`), forwarded by the handler
   *   for the shared per-subject daily AI quota (CL-D7 — same budget as tailoring).
   * - `listing`: raw pasted job-listing text; the service does hygiene/truncation itself,
   *   then stage-1 cleanup via the CACHED extraction decorator (a hit is expected right
   *   after tailoring the same listing — CL-D6).
   * - `content`: the tailored resume content for this listing — decoded from the wire patch
   *   at the HttpApi edge (CL-D2).
   * - `baseVersion`: already validated against `CONTENT_DEFAULTS_VERSION` by the handler.
   *
   * Returns the rendered PDF bytes (`%PDF`-checked). Pipeline failures are typed
   * `CoverLetterError` (handler maps to 500 with the raw nested cause); quota stays a
   * separate 400.
   */
  readonly generateCoverLetter: (
    subject: string,
    listing: string,
    content: ResumeContent.ContentState,
    baseVersion: string,
  ) => Effect.Effect<Uint8Array, CoverLetterError | TailorQuotaExceeded>
}

export class CoverLetterService extends Context.Service<CoverLetterService, CoverLetterServiceDef>()(
  CoverLetterServiceId,
) {}

/** {@inheritDoc CoverLetterServiceDef.generateCoverLetter} */
export const generateCoverLetter = Effect.fn("CoverLetterService.generateCoverLetter")(function*(
  ...params: Parameters<CoverLetterServiceDef["generateCoverLetter"]>
): Effect.fn.Return<Uint8Array, CoverLetterError | TailorQuotaExceeded, CoverLetterService> {
  const svc = yield* CoverLetterService
  return yield* svc.generateCoverLetter(...params)
})
