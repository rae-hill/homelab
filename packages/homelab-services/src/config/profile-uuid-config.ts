import { Context } from "effect"
import type { UUID } from "../services/uuid-service.js"

export const ProfileUuidConfigId = "homelab-api/config/profile-uuid-config/ProfileUuidConfig"

export interface ProfileUuidConfigDef {
  /** Looks up the MDM payload UUID for a known Wi-Fi SSID, returning `null` if the SSID is unrecognized. */
  homelabPayloadWifiUuid(ssidName: string): UUID | null

  /** Payload UUID for the root CA certificate MDM entry. */
  readonly homelabPayloadRootCertUuid: UUID

  /** Payload UUID for the intermediate CA certificate MDM entry. */
  readonly homelabPayloadIntermediateCertUuid: UUID

  /** Payload UUID for the ACME configuration MDM entry. */
  readonly homelabPayloadAcmeUuid: UUID

  /**
   * UUID identifying the top-level homelab certificate config for standalone certificates
   */
  readonly homelabConfigCertsUuid: UUID

  /** UUID identifying the top-level homelab configuration profile for wifi. */
  readonly homelabConfigWifiUuid: UUID

  /** UUID identifying the top-level homelab configuration profile for acme. */
  readonly homelabConfigAcmeUuid: UUID

  /**
   * UUID identifying the top-level homelab DNS configuration profile
   *
   * @remarks
   * DNS here is separated so it can be deleted without interfering with Wifi connection.
   * This will be useful when debugging network issues.
   */
  readonly homelabConfigDnsUuid: UUID

  /** Payload UUID for the 802.1X Global Ethernet MDM entry. */
  readonly homelabPayloadEthernetUuid: UUID
}

export class ProfileUuidConfig
  extends Context.Service<ProfileUuidConfig, ProfileUuidConfigDef>()(ProfileUuidConfigId)
{}
