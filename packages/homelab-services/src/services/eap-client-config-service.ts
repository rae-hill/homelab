import type { Effect } from "effect"
import { Context } from "effect"

import type * as Schemas from "../schemas/index.js"

export const EapClientConfigServiceId = "homelab-api/services/eap-client-config-service/EapClientConfigService"

export interface EapClientConfigServiceDef {
  /** Generates a PEAP EAP client configuration. */
  peapConfig(
    username: string,
    password: string,
  ): Effect.Effect<Schemas.WifiConfig.PEAPClientConfiguration>

  /** Generates an EAP-TLS client configuration. */
  eapTlsConfig(): Effect.Effect<Schemas.WifiConfig.EAPTLSClientConfiguration>
}

export class EapClientConfigService
  extends Context.Service<EapClientConfigService, EapClientConfigServiceDef>()(EapClientConfigServiceId)
{}
