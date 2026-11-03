import type { Types } from "effect"
import { HttpApiEndpoint } from "effect/http-api"
import { ApiErrors, Middleware, type ResourceURIs, Schemas } from "homelab-services"

export const URI = "OAuth_Token" satisfies ResourceURIs.ResourceURIs
export type URI = typeof URI

export const TokenEndpoint = HttpApiEndpoint.post("token", "/oauth/token", {
  success: Schemas.Token.TokenResponse,
  error: [
    ApiErrors.AuthenticationError,
    ApiErrors.AuthorizationError,
    ApiErrors.BadRequest,
    ApiErrors.InternalServerError,
  ],
  headers: Schemas.Token.TokenHeaders,
}).middleware(Middleware.BasicAuthMiddleware)

export type TokenEndpoint = typeof TokenEndpoint

export type TokenEndpointHandlerArgs = Types.Simplify<
  HttpApiEndpoint.Request<TokenEndpoint>
>

declare module "homelab-services/resource-uris" {
  interface URIToParams {
    [URI]: TokenEndpointHandlerArgs
  }
}
