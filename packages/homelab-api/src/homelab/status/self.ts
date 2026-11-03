import type { Types } from "effect"
import { HttpApiEndpoint } from "effect/http-api"
import { ApiErrors, Middleware, type ResourceURIs, Schemas } from "homelab-services"

export const URI = "Status_Self" satisfies ResourceURIs.ResourceURIs
export type URI = typeof URI

export const SelfEndpoint = HttpApiEndpoint.get("self", "/status/self", {
  success: Schemas.StatusSelf.StatusSelfResponseSchema,
  error: [
    ApiErrors.AuthorizationError,
    ApiErrors.AuthenticationError,
    ApiErrors.InternalServerError,
  ],
  headers: Schemas.Token.TokenHeaders,
}).middleware(Middleware.AuthMiddleware)

export type SelfEndpoint = typeof SelfEndpoint

export type SelfEndpointHandlerArgs = Types.Simplify<
  HttpApiEndpoint.Request<SelfEndpoint>
>

declare module "homelab-services/resource-uris" {
  interface URIToParams {
    [URI]: SelfEndpointHandlerArgs
  }
}
