import type { Effect } from "effect"
import { Context } from "effect"
import type { Option } from "effect/Option"

import type * as ApiErrors from "../errors/http-errors.js"
import type * as Schemas from "../schemas/index.js"

export const DnsProfileServiceId = "homelab-api/services/dns-profile-generator/DnsProfileService"

export interface DnsProfileServiceDef {
  /** Generates a DNS MDM profile for Tailscale private (logging off). */
  tailscalePrivate(
    name: string,
    ssid: Option<string>,
  ): Effect.Effect<Schemas.RootPayload.RootPayloadWire, ApiErrors.HttpApiEncodeError>

  /** Generates a DNS MDM profile for Tailscale monitoring (logging on). */
  tailscaleMonitor(
    name: string,
    ssid: Option<string>,
  ): Effect.Effect<Schemas.RootPayload.RootPayloadWire, ApiErrors.HttpApiEncodeError>

  /** Generates a DNS MDM profile for homelab private (adblocking, logging off). */
  homelabPrivate(
    name: string,
    ssid: Option<string>,
  ): Effect.Effect<Schemas.RootPayload.RootPayloadWire, ApiErrors.HttpApiEncodeError>

  /** Generates a DNS MDM profile for homelab resolver-only (no adblocking, resolves homelab URLs). */
  homelabPrivateResolverOnly(
    name: string,
    ssid: string,
  ): Effect.Effect<Schemas.RootPayload.RootPayloadWire, ApiErrors.HttpApiEncodeError>
}

export class DnsProfileService
  extends Context.Service<DnsProfileService, DnsProfileServiceDef>()(DnsProfileServiceId)
{}
