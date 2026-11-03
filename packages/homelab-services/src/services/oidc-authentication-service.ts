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
export function authorizeOIDC(
  ...params: Parameters<OIDCAuthenticationServiceDef["authorizeOIDC"]>
): Effect.Effect<Identity, AuthenticationError | InternalServerError, OIDCAuthenticationService> {
  return OIDCAuthenticationService.pipe(
    Effect.flatMap(
      (_) => _.authorizeOIDC(...params),
    ),
  )
}
