import { Schema, Tuple, type Types } from "effect"
import { HttpApiEndpoint } from "effect/http-api"
import { ApiErrors, Middleware, Schemas } from "homelab-services"
import { EncryptionParam, SSIDParam, WifiMobileConfigParams } from "./wifi.js"

export const WifiMobileConfigDownloadParams = WifiMobileConfigParams
  .mapMembers(Tuple.map(Schema.fieldsAssign(Schemas.Token.AuthQueryParams.fields)))

export const WifiMobileConfigDownload = HttpApiEndpoint.get(
  "wifi-download",
  "/mobile-config/wifi/:ssid/:encryption/_download",
  {
    params: {
      ssid: SSIDParam,
      encryption: EncryptionParam,
    },
    query: WifiMobileConfigDownloadParams,
    success: Schemas.XML.XMLSchema,
    error: [
      ApiErrors.NotImplemented,
      ApiErrors.InternalServerError,
      ApiErrors.BadRequest,
      ApiErrors.NotFound,
      ApiErrors.HttpApiEncodeError,
      ApiErrors.AuthenticationError,
      ApiErrors.AuthorizationError,
    ],
    headers: Schemas.Token.TokenHeaders,
  },
).middleware(Middleware.AuthMiddleware)

export type WifiMobileConfigDownloadEndpoint = typeof WifiMobileConfigDownload

export type WifiMobileConfigDownloadHandlerArgs = Types.Simplify<
  HttpApiEndpoint.Request<WifiMobileConfigDownloadEndpoint>
>
