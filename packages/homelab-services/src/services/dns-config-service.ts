import type { Effect } from "effect"
import { Context } from "effect"
import type { Option } from "effect/Option"

import type * as Schemas from "../schemas/index.js"

export const DnsConfigServiceId = "homelab-api/services/dns-config-service/DnsConfigService"

export interface DnsConfigServiceDef {
  /** Builds a DNS config payload for Tailscale private (logging off). */
  tailscalePrivate(name: string, ssid: Option<string>): Effect.Effect<Schemas.DnsConfig.DNSConfig>

  /** Builds a DNS config payload for Tailscale monitoring (logging on). */
  tailscaleMonitor(name: string, ssid: Option<string>): Effect.Effect<Schemas.DnsConfig.DNSConfig>

  /** Builds a DNS config payload for homelab private (adblocking, logging off). */
  homelabPrivate(name: string, ssid: Option<string>): Effect.Effect<Schemas.DnsConfig.DNSConfig>

  /** Builds a DNS config payload for homelab resolver-only (no adblocking, resolves homelab URLs). */
  homelabPrivateResolverOnly(name: string, ssid: string): Effect.Effect<Schemas.DnsConfig.DNSConfig>
}

export class DnsConfigService extends Context.Service<DnsConfigService, DnsConfigServiceDef>()(DnsConfigServiceId) {}
