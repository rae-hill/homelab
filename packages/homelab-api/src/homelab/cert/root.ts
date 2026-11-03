import type { Types } from "effect"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema } from "effect/http-api"
import { ApiErrors, Middleware, type ResourceURIs, Schemas } from "homelab-services"

export const URI = "Cert_Root" satisfies ResourceURIs.ResourceURIs
export type URI = typeof URI

export const FormatParam = Schemas.CertFormat.CertFormat

export const RootCert = HttpApiEndpoint.get("root", "/cert/root/:format", {
  params: { format: FormatParam },
  success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
  error: [ApiErrors.AuthorizationError],
  headers: Schemas.Token.TokenHeaders,
}).middleware(Middleware.AuthMiddleware)

export type RootCertEndpoint = typeof RootCert

export type RootCertHandlerArgs = Types.Simplify<
  HttpApiEndpoint.Request<RootCertEndpoint>
>

declare module "homelab-services/resource-uris" {
  interface URIToParams {
    [URI]: RootCertHandlerArgs
  }
}
