import type { Types } from "effect"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema } from "effect/http-api"
import { ApiErrors, Middleware, type ResourceURIs, Schemas } from "homelab-services"

export const URI = "Resume_Print" satisfies ResourceURIs.ResourceURIs
export type URI = typeof URI

/**
 * POST /resume/print — render the resume site in headless chrome with the given
 * print config (base64 blob, validated by the shared schema) and return the PDF bytes.
 */
export const ResumePrint = HttpApiEndpoint.post("print", "/resume/print", {
  payload: Schemas.Resume.ResumePrintRequest,
  query: Schemas.Resume.ResumePrintQuery,
  success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: "application/pdf" })),
  error: [
    ApiErrors.AuthorizationError,
    ApiErrors.AuthenticationError,
    ApiErrors.BadRequest,
    ApiErrors.InternalServerError,
    ApiErrors.HttpApiEncodeError,
  ],
  headers: Schemas.Token.TokenHeaders,
}).middleware(Middleware.AuthMiddleware)

export type ResumePrintEndpoint = typeof ResumePrint

export type ResumePrintHandlerArgs = Types.Simplify<
  HttpApiEndpoint.Request<ResumePrintEndpoint>
>

declare module "homelab-services/resource-uris" {
  interface URIToParams {
    [URI]: ResumePrintHandlerArgs
  }
}
