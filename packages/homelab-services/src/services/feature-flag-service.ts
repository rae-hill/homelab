import { Context, Effect } from "effect"
import type { Operation } from "../operation.js"
import type { ResourceURIs } from "../resource-uris.js"

export const FeatureFlagServiceId = "homelab-api/services/feature-flag-service/FeatureFlagService"

export interface FeatureFlagServiceDef {
  /** Returns whether a feature flag is enabled for the given resource and operation. */
  enabled(resource: ResourceURIs, operation: Operation): boolean
}

export class FeatureFlagService
  extends Context.Service<FeatureFlagService, FeatureFlagServiceDef>()(FeatureFlagServiceId)
{
}

/** {@inheritDoc FeatureFlagServiceDef.enabled} */
export const enabled = Effect.fn("FeatureFlagService.enabled")(function*(
  ...params: Parameters<FeatureFlagServiceDef["enabled"]>
): Effect.fn.Return<
  boolean,
  never,
  FeatureFlagService
> {
  const svc = yield* FeatureFlagService
  return svc.enabled(...params)
})
