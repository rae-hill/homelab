import type { Types } from "effect"
import { HttpApiEndpoint } from "effect/http-api"
import { ApiErrors, Middleware, Schemas } from "homelab-services"

export const CertsDownload = HttpApiEndpoint.get("certs-download", "/mobile-config/certs/_download", {
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

export type CertsDownloadEndpoint = typeof CertsDownload

export type CertsDownloadHandlerArgs = Types.Simplify<
  HttpApiEndpoint.Request<CertsDownloadEndpoint>
>
