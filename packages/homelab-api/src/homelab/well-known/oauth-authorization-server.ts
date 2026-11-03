import type { Types } from "effect"
import { HttpApiEndpoint } from "effect/http-api"
import { Schemas } from "homelab-services"

export const OAuthAuthorizationWellKnownEndpoint = HttpApiEndpoint.get(
  "well-known-oauth-authorization",
  "/.well-known/oauth-authorization-server",
  {
    success: Schemas.WellKnown.OAuthAuthorizationServerWellKnown,
  },
)

export type OAuthAuthorizationWellKnownEndpoint = typeof OAuthAuthorizationWellKnownEndpoint

export type HealthEndpointHandlerArgs = Types.Simplify<
  HttpApiEndpoint.Request<OAuthAuthorizationWellKnownEndpoint>
>
