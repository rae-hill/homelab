import { Context, Effect } from "effect"
import type { JWTVerifyGetKey } from "jose"
import type { AuthenticationError, InternalServerError } from "../errors/http-errors.js"
import type { Identity } from "../identity.js"

export const OIDCAuthenticationServiceId = "homelab-api/services/oidc-authentication-service/OIDCAuthenticationService"

export interface OIDCAuthenticationServiceDef {
  /** Validates an OIDC JWT using the provided JWK and returns the authenticated identity. */
  authorizeOIDC(
    jwt: Buffer,
    jwk: JWTVerifyGetKey,
    issuer: string,
  ): Effect.Effect<Identity, AuthenticationError | InternalServerError>
}

export class OIDCAuthenticationService
  extends Context.Service<OIDCAuthenticationService, OIDCAuthenticationServiceDef>()(OIDCAuthenticationServiceId)
{
}

/** {@inheritDoc OIDCAuthenticationServiceDef.authorizeOIDC} */
export const authorizeOIDC = Effect.fn("OIDCAuthenticationService.authorizeOIDC")(function*(
  ...params: Parameters<OIDCAuthenticationServiceDef["authorizeOIDC"]>
): Effect.fn.Return<Identity, AuthenticationError | InternalServerError, OIDCAuthenticationService> {
  const svc = yield* OIDCAuthenticationService
  return yield* svc.authorizeOIDC(...params)
})
