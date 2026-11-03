import type { Effect } from "effect"
import { Context } from "effect"

import type * as Schemas from "../schemas/index.js"

export const EthernetConfigServiceId = "homelab-api/services/ethernet-config-service/EthernetConfigService"

export interface EthernetConfigServiceDef {
  /** Generates an 802.1X Global Ethernet MDM payload using the given EAP client configuration. */
  ethernetConfig(
    eapClientConfiguration: Schemas.WifiConfig.EnterpriseClientConfiguration,
  ): Effect.Effect<Schemas.WifiConfig.EthernetConfig>
}

export class EthernetConfigService
  extends Context.Service<EthernetConfigService, EthernetConfigServiceDef>()(EthernetConfigServiceId)
{}
