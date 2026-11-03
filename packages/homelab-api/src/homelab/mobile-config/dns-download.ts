import type { Types } from "effect"
import { HttpApiEndpoint } from "effect/http-api"
import { ApiErrors, Middleware, Schemas } from "homelab-services"
import { DnsProfileParam, DnsQueryParams } from "./dns.js"

export const DnsDownload = HttpApiEndpoint.get("dns-download", "/mobile-config/dns/:profile/_download", {
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

export type DnsDownloadEndpoint = typeof DnsDownload

export type DnsDownloadHandlerArgs = Types.Simplify<
  HttpApiEndpoint.Request<DnsDownloadEndpoint>
>
