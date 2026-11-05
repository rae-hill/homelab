import { Context, Effect } from "effect"
import type { AuthenticationError, InternalServerError } from "../errors/http-errors.js"
import type { Identity } from "../identity.js"

export const ClaimCheckServiceId = "homelab-api/services/authentication-service/ClaimCheckService"

export type ClaimCheckServiceDef = {
  /**
   * issues a new claim check
   */
  readonly issue: (
    identity: Identity,
  ) => Effect.Effect<
    string,
    InternalServerError
  >

  /**
   * validates an incoming claim check against the stored idenities
   */
  readonly validate: (
    claimCheck: string,
  ) => Effect.Effect<
    Identity,
    AuthenticationError
  >
}

export class ClaimCheckService extends Context.Service<ClaimCheckService, ClaimCheckServiceDef>()(ClaimCheckServiceId) {
}

/** {@inheritDoc ClaimCheckServiceDef.issue} */
export const issue = Effect.fn("ClaimCheckService.issue")(function*(
  ...params: Parameters<ClaimCheckServiceDef["issue"]>
): Effect.fn.Return<
  string,
  InternalServerError,
  ClaimCheckService
> {
  const svc = yield* ClaimCheckService
  return yield* svc.issue(...params)
})

/** {@inheritDoc ClaimCheckServiceDef.validate} */
export const validate = Effect.fn("ClaimCheckService.validate")(function*(
  ...params: Parameters<ClaimCheckServiceDef["validate"]>
): Effect.fn.Return<
  Identity,
  AuthenticationError,
  ClaimCheckService
> {
  const svc = yield* ClaimCheckService
  return yield* svc.validate(...params)
})
