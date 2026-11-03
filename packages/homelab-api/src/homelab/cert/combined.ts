import type { Types } from "effect"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema } from "effect/http-api"
import { ApiErrors, Middleware, type ResourceURIs, Schemas } from "homelab-services"

export const URI = "Cert_Combined" satisfies ResourceURIs.ResourceURIs
export type URI = typeof URI

export const CombinedCert = HttpApiEndpoint.get("combined", "/cert/combined", {
  success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
  error: [ApiErrors.AuthorizationError],
  headers: Schemas.Token.TokenHeaders,
}).middleware(Middleware.AuthMiddleware)

export type CombinedCertEndpoint = typeof CombinedCert

export type CombinedCertHandlerArgs = Types.Simplify<
  HttpApiEndpoint.Request<CombinedCertEndpoint>
>

declare module "homelab-services/resource-uris" {
  interface URIToParams {
    [URI]: CombinedCertHandlerArgs
  }
}
