import type { Types } from "effect"
import { Schema } from "effect"
import { HttpApiEndpoint } from "effect/http-api"
import { ApiErrors, Middleware, type ResourceURIs, Schemas } from "homelab-services"

export const URI = "Config_DNS" satisfies ResourceURIs.ResourceURIs
export type URI = typeof URI

export const DnsProfileParam = Schemas.DnsProfile.DnsProfileSchema

export const DnsQueryParams = Schemas.Token.AuthQueryParams.pipe(
  Schema.fieldsAssign({
    name: Schemas.Optionals.Optional(Schema.String),
    ssid: Schemas.Optionals.Optional(Schema.String),
  }),
)

export const Dns = HttpApiEndpoint.get("dns", "/mobile-config/dns/:profile", {
  params: { profile: DnsProfileParam },
  query: DnsQueryParams,
  success: Schemas.XML.XMLSchema,
  error: [
    ApiErrors.InternalServerError,
    ApiErrors.BadRequest,
    ApiErrors.AuthorizationError,
    ApiErrors.AuthenticationError,
    ApiErrors.HttpApiEncodeError,
  ],
  headers: Schemas.Token.TokenHeaders,
}).middleware(Middleware.AuthMiddleware)

export type DnsEndpoint = typeof Dns

export type DnsHandlerArgs = Types.Simplify<
  HttpApiEndpoint.Request<DnsEndpoint>
>

declare module "homelab-services/resource-uris" {
  interface URIToParams {
    [URI]: DnsHandlerArgs
  }
}
