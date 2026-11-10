import { Effect, flow, Match } from "effect"
import type { Homelab } from "homelab-api"
import { ApiErrors, Middleware, Services } from "homelab-services"

/**
 * POST /resume/print — authorize against the `Resume_Print` resource (roles claim from
 * the kanidm `resume.printing` group), then render the resume with headless chrome in
 * the requested output format (`pdf` default, or `docx`). The payload's base64 blob is
 * schema-validated at the edge (`ConfigBase64String`) and seeded into the site's
 * localStorage before rendering.
 */
export const handleResumePrint = Effect.fn("handleResumePrint")(
  function*(args: Homelab.ResumeEndpoints.Print.ResumePrintHandlerArgs) {
    const identity = yield* Middleware.CurrentIdentity
    yield* Services.AuthorizationService.canCreate(identity, "Resume_Print", args)

    return yield* Services.ResumePrintingService.printResume(
      args.payload.config,
      args.query.theme,
      args.query.outputFormat,
    )
  },
  Effect.tapError(Effect.logError),
  Effect.mapError(
    flow(
      Match.value,
      Match.tag("ResumePrintError", (err) =>
        new ApiErrors.InternalServerError({
          message: err.message,
        })),
      Match.orElse((_) => _),
    ),
  ),
)
