import type { Types } from "effect"
import { HttpApiEndpoint } from "effect/http-api"
import { ApiErrors, Middleware, type ResourceURIs, Schemas } from "homelab-services"

export const URI = "OAuth_ClaimCheck" satisfies ResourceURIs.ResourceURIs
export type URI = typeof URI

export const ClaimCheckEndpoint = HttpApiEndpoint.post("claim-check", "/oauth/claim-check", {
  success: Schemas.ClaimCheck.ClaimCheckResponse,
  error: [
    ApiErrors.AuthenticationError,
    ApiErrors.AuthorizationError,
    ApiErrors.InternalServerError,
  ],
  headers: Schemas.Token.TokenHeaders,
}).middleware(Middleware.AuthMiddleware)

export type ClaimCheckEndpoint = typeof ClaimCheckEndpoint

export type ClaimCheckEndpointHandlerArgs = Types.Simplify<
  HttpApiEndpoint.Request<ClaimCheckEndpoint>
>

declare module "homelab-services/resource-uris" {
  interface URIToParams {
    [URI]: ClaimCheckEndpointHandlerArgs
  }
}
