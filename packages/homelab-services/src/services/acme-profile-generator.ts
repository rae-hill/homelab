import { Context, Effect } from "effect"

import type * as ApiErrors from "../errors/http-errors.js"
import type * as Schemas from "../schemas/index.js"
import type { AcmeConfigService } from "./acme-config-service.js"

export const AcmeProfileServiceId = "homelab-api/services/acme-profile-generator/AcmeProfileGenerator"

export interface AcmeProfileServiceDef {
  /** Generates a complete root MDM profile payload containing the ACME configuration. */
  acmeProfile(
    ...params: Parameters<typeof AcmeConfigService.Service.acmeConfig>
  ): Effect.Effect<Schemas.RootPayload.RootPayloadWire, ApiErrors.HttpApiEncodeError>
}

export class AcmeProfileService
  extends Context.Service<AcmeProfileService, AcmeProfileServiceDef>()(AcmeProfileServiceId)
{
}

/** {@inheritDoc AcmeProfileServiceDef.acmeProfile} */
export const acmeProfile = Effect.fn("AcmeProfileService.acmeProfile")(function*(
  ...args: Parameters<AcmeProfileServiceDef["acmeProfile"]>
): Effect.fn.Return<
  Schemas.RootPayload.RootPayloadWire,
  ApiErrors.HttpApiEncodeError,
  AcmeProfileService
> {
  const svc = yield* AcmeProfileService
  return yield* svc.acmeProfile(...args)
})
