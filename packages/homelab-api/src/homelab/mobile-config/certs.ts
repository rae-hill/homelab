import type { Types } from "effect"
import { HttpApiEndpoint } from "effect/http-api"
import { ApiErrors, Middleware, type ResourceURIs, Schemas } from "homelab-services"

export const URI = "Config_Certs" satisfies ResourceURIs.ResourceURIs
export type URI = typeof URI

export const Certs = HttpApiEndpoint.get("certs", "/mobile-config/certs", {
  query: Schemas.Token.AuthQueryParams,
  success: Schemas.XML.XMLSchema,
  error: [
    ApiErrors.NotImplemented,
    ApiErrors.InternalServerError,
    ApiErrors.BadRequest,
    ApiErrors.NotFound,
    ApiErrors.HttpApiEncodeError,
    ApiErrors.AuthorizationError,
    ApiErrors.AuthenticationError,
  ],
  headers: Schemas.Token.TokenHeaders,
}).middleware(Middleware.AuthMiddleware)

export type CertsEndpoint = typeof Certs

export type CertsHandlerArgs = Types.Simplify<
  HttpApiEndpoint.Request<CertsEndpoint>
>

declare module "homelab-services/resource-uris" {
  interface URIToParams {
    [URI]: CertsHandlerArgs
  }
}
