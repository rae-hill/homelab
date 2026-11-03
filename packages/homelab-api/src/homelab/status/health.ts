import type { Types } from "effect"
import { HttpApiEndpoint } from "effect/http-api"
import { ApiErrors, Middleware, type ResourceURIs, Schemas } from "homelab-services"

export const URI = "Status_Health" satisfies ResourceURIs.ResourceURIs
export type URI = typeof URI

export const HealthEndpoint = HttpApiEndpoint.get("health", "/status/health", {
  success: Schemas.Health.HealthResponseSchema,
  error: [
    ApiErrors.HttpApiEncodeError,
    ApiErrors.AuthorizationError,
    ApiErrors.AuthenticationError,
  ],
  headers: Schemas.Token.TokenHeaders,
}).middleware(Middleware.AuthMiddleware)

export type HealthEndpoint = typeof HealthEndpoint

export type HealthEndpointHandlerArgs = Types.Simplify<
  HttpApiEndpoint.Request<HealthEndpoint>
>

declare module "homelab-services/resource-uris" {
  interface URIToParams {
    [URI]: HealthEndpointHandlerArgs
  }
}
