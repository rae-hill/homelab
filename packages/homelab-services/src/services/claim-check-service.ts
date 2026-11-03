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
export function issue(
  ...params: Parameters<ClaimCheckServiceDef["issue"]>
): Effect.Effect<
  string,
  InternalServerError,
  ClaimCheckService
> {
  return ClaimCheckService.pipe(
    Effect.flatMap(
      (_) => _.issue(...params),
    ),
  )
}

/** {@inheritDoc ClaimCheckServiceDef.validate} */
export function validate(
  ...params: Parameters<ClaimCheckServiceDef["validate"]>
): Effect.Effect<
  Identity,
  AuthenticationError,
  ClaimCheckService
> {
  return ClaimCheckService.pipe(
    Effect.flatMap(
      (_) => _.validate(...params),
    ),
  )
}
