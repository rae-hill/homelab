import type { Option } from "effect"
import { Context, Effect } from "effect"

export const SerialNumberConfigId = "homelab-api/config/serial-number-config/SerialNumberConfig"

export interface SerialNumberConfigDef {
  /** Resolves an IP address to a device serial number, or None if not found. */
  readonly resolveIp: (ip: string) => Option.Option<string>
}

export class SerialNumberConfig
  extends Context.Service<SerialNumberConfig, SerialNumberConfigDef>()(SerialNumberConfigId)
{}

/** {@inheritDoc SerialNumberConfigDef.resolveIp} */
export function resolveIp(
  ip: string,
): Effect.Effect<Option.Option<string>, never, SerialNumberConfig> {
  return SerialNumberConfig.pipe(Effect.map((_) => _.resolveIp(ip)))
}
