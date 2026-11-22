import { Effect, flow, Match } from "effect"
import type { Homelab } from "homelab-api"
import { ApiErrors, Middleware, Services } from "homelab-services"
import { ResumeContent } from "shared"

/**
 * POST /resume/cover-letter — authorize against the `Resume_CoverLetter` resource
 * (roles claim from the kanidm `homelab.resume.coverletter` group), reject stale
 * `baseVersion` values against the frozen shared defaults, then delegate to the
 * cover-letter pipeline. The payload's `content` arrives as a decoded `ContentState`
 * (the `ContentPatchBase64` edge codec); the response is raw PDF bytes. The handler
 * names WHAT happens — every HOW lives behind service accessors (owner design rule);
 * quota exhaustion is a 4xx (shared AI-spend cap, CL-D7), pipeline failure is a 500
 * with the raw nested cause (D12 semantics).
 */
export const handleResumeCoverLetter = Effect.fn("handleResumeCoverLetter")(
  function*(args: Homelab.ResumeEndpoints.CoverLetter.ResumeCoverLetterHandlerArgs) {
    const identity = yield* Middleware.CurrentIdentity
    yield* Services.AuthorizationService.canCreate(identity, "Resume_CoverLetter", args)

    const { baseVersion, content, listing } = args.payload
    if (baseVersion !== ResumeContent.CONTENT_DEFAULTS_VERSION) {
      return yield* new ApiErrors.BadRequest({
        message:
          `Stale baseVersion '${baseVersion}'; server is on '${ResumeContent.CONTENT_DEFAULTS_VERSION}'. Reload to refresh defaults.`,
        reason: "resume-cover-letter-base-version-mismatch",
      })
    }

    return yield* Services.CoverLetterService.generateCoverLetter(
      identity.identifier,
      listing,
      content,
      baseVersion,
    )
  },
  Effect.tapError(Effect.logError),
  Effect.mapError(
    flow(
      Match.value,
      Match.tag("TailorQuotaExceeded", (err) =>
        new ApiErrors.BadRequest({
          message: `Daily AI quota exceeded; retry in ~${err.retryAfterSeconds}s.`,
          reason: "resume-cover-letter-quota-exceeded",
        })),
      Match.tag("CoverLetterError", (err) =>
        new ApiErrors.InternalServerError({
          message: err.message,
          error: err.error,
        })),
      Match.orElse((_) => _),
    ),
  ),
)
