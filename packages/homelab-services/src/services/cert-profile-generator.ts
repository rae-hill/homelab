import type { Effect } from "effect"
import { Context } from "effect"

import type * as ApiErrors from "../errors/http-errors.js"
import type * as Schemas from "../schemas/index.js"

export const CertProfileServiceId = "homelab-api/services/cert-profile-generator/CertProfileService"

export interface CertProfileServiceDef {
  /** Generates a root MDM profile containing the root and intermediate CA certificates. */
  readonly certProfile: Effect.Effect<Schemas.RootPayload.RootPayloadWire, ApiErrors.HttpApiEncodeError>
}

export class CertProfileService
  extends Context.Service<CertProfileService, CertProfileServiceDef>()(CertProfileServiceId)
{
}
