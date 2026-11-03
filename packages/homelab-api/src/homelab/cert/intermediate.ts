import type { Types } from "effect"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema } from "effect/http-api"
import { ApiErrors, Middleware, type ResourceURIs, Schemas } from "homelab-services"

export const URI = "Cert_Intermediate" satisfies ResourceURIs.ResourceURIs
export type URI = typeof URI

export const FormatParam = Schemas.CertFormat.CertFormat

export const IntermediateCert = HttpApiEndpoint.get("intermediate", "/cert/intermediate/:format", {
  params: { format: FormatParam },
  success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
  error: [ApiErrors.AuthorizationError],
  headers: Schemas.Token.TokenHeaders,
}).middleware(Middleware.AuthMiddleware)

export type IntermediateCertEndpoint = typeof IntermediateCert

export type IntermediateCertHandlerArgs = Types.Simplify<
  HttpApiEndpoint.Request<IntermediateCertEndpoint>
>

declare module "homelab-services/resource-uris" {
  interface URIToParams {
    [URI]: IntermediateCertHandlerArgs
  }
}
