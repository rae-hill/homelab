import { Schema } from "effect"

export const DnsProfileSchema = Schema.Literals([
  "private_tailscale",
  "monitoring_tailscale",
  "private_homelab",
  "private_homelab_resolver_only",
])

export type DnsProfile = typeof DnsProfileSchema.Type
