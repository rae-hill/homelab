import type { Types } from "effect"
import { Schema, SchemaTransformation } from "effect"
import { HttpApiEndpoint } from "effect/http-api"
import { ApiErrors, Middleware, type ResourceURIs, Schemas } from "homelab-services"

export const URI = "Config_Wifi" satisfies ResourceURIs.ResourceURIs
export type URI = typeof URI

export const WifiQueryParams = null

/**
 * v4 removed the built-in `Schema.BooleanFromString`; this preserves the v3
 * wire format ("true"/"false" strings).
 */
export const BooleanFromString = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({
      decode: (s) => s === "true",
      encode: (b) => (b ? "true" : "false"),
    }),
  ),
)

export const SSIDParam = Schema.String

export const EncryptionParam = Schema.Literals(["WPA3", "WPA2"])

export const WifiMobileConfigParamsBase = Schema.Struct({
  disableMACRandomization: Schemas.Optionals.OptionalWithDefault(
    BooleanFromString,
    () => false,
  ),
})

export const WifiMobileConfigParamsEnterpriseBase = WifiMobileConfigParamsBase.pipe(
  Schema.fieldsAssign(
    {
      includeEthernetProfile: Schemas.Optionals.OptionalWithDefault(
        BooleanFromString,
        () => false,
      ),
    },
  ),
)

export const WifiMobileConfigParamsEnterprisePEAP = WifiMobileConfigParamsEnterpriseBase.pipe(
  Schema.fieldsAssign(
    {
      username: Schema.String,
      enterpriseClientType: Schema.Literal("PEAP"),
      password: Schema.String,
    },
  ),
)

export const WifiMobileConfigParamsEnterpriseEAPTLS = WifiMobileConfigParamsEnterpriseBase.pipe(
  Schema.fieldsAssign(
    {
      enterpriseClientType: Schema.Literal("EAP-TLS"),
    },
  ),
)

export const WifiMobileConfigParamsPersonal = WifiMobileConfigParamsBase.pipe(
  Schema.fieldsAssign(
    {
      enterpriseClientType: Schema.Literal("None"),
      password: Schema.String,
    },
  ),
)

export const WifiMobileConfigParams = Schema.Union([
  WifiMobileConfigParamsPersonal,
  WifiMobileConfigParamsEnterprisePEAP,
  WifiMobileConfigParamsEnterpriseEAPTLS,
])

export type WifiMobileConfigParamsWire = typeof WifiMobileConfigParams.Encoded
export type WifiMobileConfigParams = typeof WifiMobileConfigParams.Type

export const WifiMobileConfig = HttpApiEndpoint.put("wifi", "/mobile-config/wifi/:ssid/:encryption", {
  params: {
    ssid: SSIDParam,
    encryption: EncryptionParam,
  },
  payload: WifiMobileConfigParams,
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

export type WifiMobileConfigEndpoint = typeof WifiMobileConfig

export type WifiMobileConfigHandlerArgs = Types.Simplify<
  HttpApiEndpoint.Request<WifiMobileConfigEndpoint>
>

declare module "homelab-services/resource-uris" {
  interface URIToParams {
    [URI]: WifiMobileConfigHandlerArgs
  }
}
