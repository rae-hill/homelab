import type { Option } from "effect"
import { Context, Effect } from "effect"
import type { AuthenticationError, BadRequest, InternalServerError } from "../errors/http-errors.js"
import type { Identity } from "../identity.js"
import type { HTTPMethod } from "../schemas/HTTPMethod.js"
import type { HMACDigestError } from "./hmac-service.js"
import type { NonceValidationError } from "./nonce-service.js"

export const AuthenticationServiceId = "homelab-api/services/authentication-service/AuthenticationService"

export type AuthenticationServiceDef = {
  /** Authenticates a DPoP-bound JWT and returns the associated identity.
   * For local issuers the DPoP proof is validated; for remote OIDC providers it is skipped. */
  readonly authenticate: (
    jwt: Option.Option<Buffer>,
    expectedHtu: URL,
    expectedHtm: HTTPMethod,
    dpopTokens: ReadonlyArray<string>,
  ) => Effect.Effect<
    Identity,
    AuthenticationError | BadRequest | InternalServerError | NonceValidationError | HMACDigestError
  >
}

export class AuthenticationService
  extends Context.Service<AuthenticationService, AuthenticationServiceDef>()(AuthenticationServiceId)
{
}

/** {@inheritDoc AuthenticationServiceDef.authenticate} */
export const authenticate = Effect.fn("AuthenticationService.authenticate")(function*(
  ...params: Parameters<AuthenticationServiceDef["authenticate"]>
): Effect.fn.Return<
  Identity,
  AuthenticationError | BadRequest | InternalServerError | NonceValidationError | HMACDigestError,
  AuthenticationService
> {
  const svc = yield* AuthenticationService
  return yield* svc.authenticate(...params)
})
