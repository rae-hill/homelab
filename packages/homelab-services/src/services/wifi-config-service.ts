import type { Effect } from "effect"
import { Context, Data } from "effect"

import type * as Schemas from "../schemas/index.js"

export const WifiConfigServiceId = "homelab-api/services/wifi-config-service/WifiConfigService"

export class WifiConfigGenerationError extends Data.TaggedError("WifiConfigGenerationError")<{
  readonly error: string
  readonly reason: "ssid-not-found"
}> {}

export interface WifiConfigServiceDef {
  /** Generates an MDM Wi-Fi payload for WPA3-Enterprise PEAP authentication. */
  wpa3EnterprisePeapWifi(
    ssidString: string,
    username: string,
    password: string,
    disableMACRandomization?: boolean,
    includeEthernetProfile?: boolean,
  ): Effect.Effect<Schemas.WifiConfig.WifiConfig, WifiConfigGenerationError>

  /** Generates an MDM Wi-Fi payload for WPA3-Enterprise EAP-TLS authentication. */
  wpa3EnterpriseEAPTLSWifi(
    ssidString: string,
    serialNumber: string,
    disableMACRandomization?: boolean,
    includeEthernetProfile?: boolean,
  ): Effect.Effect<Schemas.WifiConfig.WifiConfig, WifiConfigGenerationError>

  /** Generates an MDM Wi-Fi payload for WPA2/WPA3 personal authentication. */
  wpaPersonalWifi(
    wpaPersonalWifi: Schemas.WifiConfig.WifiEncryptionType,
    ssidString: string,
    password: string,
    disableMACRandomization?: boolean,
  ): Effect.Effect<Schemas.WifiConfig.WifiConfig, WifiConfigGenerationError>
}

export class WifiConfigService extends Context.Service<WifiConfigService, WifiConfigServiceDef>()(WifiConfigServiceId) {
}
