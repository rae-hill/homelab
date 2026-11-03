import type { Effect } from "effect"
import { Context } from "effect"

import type * as Schemas from "../schemas/index.js"

export const AcmeConfigServiceId = "homelab-api/services/acme-config-service/AcmeConfigService"

export interface AcmeConfigServiceDef {
  /** Generates the ACME MDM payload config for the given client identifier. */
  acmeConfig(
    clientIdentifier: string,
  ): Effect.Effect<Schemas.ACME.AcmeConfig>
}

export class AcmeConfigService extends Context.Service<AcmeConfigService, AcmeConfigServiceDef>()(AcmeConfigServiceId) {
}
