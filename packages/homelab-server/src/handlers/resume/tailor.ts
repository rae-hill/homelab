import { Effect, flow, Match } from "effect"
import type { Homelab } from "homelab-api"
import { ApiErrors, Middleware, Services } from "homelab-services"
import { ResumeContent } from "shared"

/**
 * POST /resume/tailor — authorize against the `Resume_Tailor` resource, reject stale
 * `baseVersion` values against the frozen shared defaults, then delegate to the
 * two-stage AI pipeline. The payload's `content` arrives as a decoded `ContentState`
 * (the `ContentPatchBase64` edge codec applies the base64 JSON Patch to the defaults);
 * the returned content is encoded back to a patch by the success codec. Quota
 * exhaustion is a 4xx (user-facing spend cap); pipeline failure is a 500 with the
 * cause chain rendered into the error message.
 */
export const handleResumeTailor = Effect.fn("handleResumeTailor")(
  function*(args: Homelab.ResumeEndpoints.Tailor.ResumeTailorHandlerArgs) {
    const identity = yield* Middleware.CurrentIdentity
    yield* Services.AuthorizationService.canCreate(identity, "Resume_Tailor", args)

    const { baseVersion, content, listing } = args.payload
    if (baseVersion !== ResumeContent.CONTENT_DEFAULTS_VERSION) {
      return yield* new ApiErrors.BadRequest({
        message:
          `Stale baseVersion '${baseVersion}'; server is on '${ResumeContent.CONTENT_DEFAULTS_VERSION}'. Reload to refresh defaults.`,
        reason: "resume-tailor-base-version-mismatch",
      })
    }

    return yield* Services.TailorService.tailorResume(
      identity.identifier,
      listing,
      content,
      baseVersion,
      args.payload.policy,
    )
  },
  Effect.tapError(Effect.logError),
  Effect.mapError(
    flow(
      Match.value,
      Match.tag("TailorQuotaExceeded", (err) =>
        new ApiErrors.BadRequest({
          message: `Daily tailor quota exceeded; retry in ~${err.retryAfterSeconds}s.`,
          reason: "resume-tailor-quota-exceeded",
        })),
      Match.tag("TailorError", (err) =>
        new ApiErrors.InternalServerError({
          message: err.message,
          error: err.error,
        })),
      Match.orElse((_) => _),
    ),
  ),
)
