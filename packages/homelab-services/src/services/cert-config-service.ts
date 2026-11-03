import type { Effect } from "effect"
import { Context } from "effect"

import type * as Schemas from "../schemas/index.js"

export const CertConfigServiceId = "homelab-api/services/cert-config-service/CertConfigService"

export interface CertConfigServiceDef {
  /** Builds an MDM certificate payload config for the root CA certificate. */
  rootCert(
    filename: string,
    payload: Buffer,
  ): Effect.Effect<Schemas.CertificatePayload.CertificateConfig>

  /** Builds an MDM certificate payload config for the intermediate CA certificate. */
  intermediateCert(
    filename: string,
    payload: Buffer,
  ): Effect.Effect<Schemas.CertificatePayload.CertificateConfig>
}

export class CertConfigService extends Context.Service<CertConfigService, CertConfigServiceDef>()(CertConfigServiceId) {
}
