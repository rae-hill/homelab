import type { Types } from "effect"
import { HttpApiEndpoint } from "effect/http-api"
import { ApiErrors, Middleware, type ResourceURIs, Schemas } from "homelab-services"

export const URI = "Resume_Tailor" satisfies ResourceURIs.ResourceURIs
export type URI = typeof URI

/**
 * POST /resume/tailor — run the two-stage AI tailoring pipeline against the given job
 * listing and resume content. The payload's `content` is a base64 JSON Patch against the
 * frozen shared defaults (`ContentPatchBase64`) and decodes to a `ContentState` at the
 * edge; the response's `content` is encoded back to a patch by the success codec.
 */
export const ResumeTailor = HttpApiEndpoint.post("tailor", "/resume/tailor", {
  payload: Schemas.ResumeTailor.ResumeTailorRequest,
  success: Schemas.ResumeTailor.ResumeTailorResponse,
  error: [
    ApiErrors.AuthorizationError,
    ApiErrors.AuthenticationError,
    ApiErrors.BadRequest,
    ApiErrors.InternalServerError,
    ApiErrors.HttpApiEncodeError,
  ],
  headers: Schemas.Token.TokenHeaders,
}).middleware(Middleware.AuthMiddleware)

export type ResumeTailorEndpoint = typeof ResumeTailor

export type ResumeTailorHandlerArgs = Types.Simplify<
  HttpApiEndpoint.Request<ResumeTailorEndpoint>
>

declare module "homelab-services/resource-uris" {
  interface URIToParams {
    [URI]: ResumeTailorHandlerArgs
  }
}
