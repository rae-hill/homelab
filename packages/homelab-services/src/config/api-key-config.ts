import { Context, Effect, type Option } from "effect"

import { type ScopeOrGroupSet } from "../schemas/scope-groups.js"

export const ApiKeyConfigId = "homelab-api/config/api-key-config/ApiKeyConfig"

export interface ApiKeyConfigDef {
  /** Returns the set of roles associated with the given API key, or `None` if the key is unrecognized. */
  readonly getRoles: (apiKey: string) => Option.Option<ScopeOrGroupSet>

  /** Returns the email associated with the given API key, or None if the key is invalid */
  readonly getEmail: (apiKey: string) => Option.Option<string>
}

export class ApiKeyConfig extends Context.Service<ApiKeyConfig, ApiKeyConfigDef>()(ApiKeyConfigId) {}

/** {@inheritDoc ApiKeyConfigDef.getRoles} */
export function getRoles(
  apiKey: string,
): Effect.Effect<Option.Option<ScopeOrGroupSet>, never, ApiKeyConfig> {
  return ApiKeyConfig.pipe(Effect.map((_) => _.getRoles(apiKey)))
}

/** {@inheritDoc ApiKeyConfigDef.getEmail} */
export function getEmail(
  apiKey: string,
): Effect.Effect<Option.Option<string>, never, ApiKeyConfig> {
  return ApiKeyConfig.pipe(Effect.map((_) => _.getEmail(apiKey)))
}
