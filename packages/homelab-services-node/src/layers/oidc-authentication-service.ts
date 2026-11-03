import { Effect, Layer, pipe, Schema } from "effect"
import { ApiErrors, Identity, Schemas, Services } from "homelab-services"
import { Constants } from "homelab-shared"
import type { JWTVerifyGetKey } from "jose"
import { jwtVerify } from "jose"
import {
  JOSEAlgNotAllowed,
  JWSInvalid,
  JWSSignatureVerificationFailed,
  JWTClaimValidationFailed,
  JWTExpired,
  JWTInvalid,
} from "jose/errors"

export const OIDCAuthenticationServiceLive = Layer.effect(
  Services.OIDCAuthenticationService.OIDCAuthenticationService,
  Effect.gen(function*() {
    yield* Effect.succeed(true)
    return new OIDCAuthenticationServiceImpl()
  }),
)

class OIDCAuthenticationServiceImpl implements Services.OIDCAuthenticationService.OIDCAuthenticationServiceDef {
  authorizeOIDC(jwt: Buffer, jwk: JWTVerifyGetKey, issuer: string) {
    return Effect.gen(function*() {
      const rawJwt = yield* Effect.tryPromise({
        try() {
          return jwtVerify(jwt, jwk, {
            audience: Constants.JWT_HOMELAB_API_AUD,
            issuer,
            requiredClaims: ["email", Constants.JWT_ROLES_KEY],
          })
        },
        catch(error) {
          if (error instanceof JWTExpired) {
            return new ApiErrors.AuthenticationError({
              error: error.message,
              reason: "expired-credential",
              message: "Failed to authenticate, recieved expired credential",
            })
          }

          if (error instanceof JWSSignatureVerificationFailed) {
            return new ApiErrors.AuthenticationError({
              error: error.message,
              reason: "signature-validation-failed",
              message: "Failed to authenticate, signature failed verification checks",
            })
          }

          if (error instanceof JWTClaimValidationFailed) {
            return new ApiErrors.AuthenticationError({
              error: error.message,
              reason: "invalid-claims",
              message: "Failed to authenticate, recieved credential with one or more invalid claims",
            })
          }

          if (error instanceof JWTInvalid || error instanceof JWSInvalid || error instanceof JOSEAlgNotAllowed) {
            return new ApiErrors.AuthenticationError({
              error: error.message,
              reason: "invalid-credential",
              message: "Failed to authenticate, recieved invalid JWT",
            })
          }

          return new ApiErrors.InternalServerError({
            message: "Encountered unexpected error: OIDCAuthenticationServiceImpl#authenticate",
            error,
          })
        },
      })

      const parsedJwt = yield* pipe(rawJwt.payload, Schema.decodeUnknownEffect(Schemas.OAuth.HomelabIdentityJWT))

      return new Identity.OIDCIdentity(
        parsedJwt.email,
        parsedJwt[Constants.JWT_ROLES_KEY],
        parsedJwt.preferred_username?.split("@")[0],
        parsedJwt.name,
      )
    }).pipe(
      Effect.catchTag(
        "SchemaError",
        (error) =>
          new ApiErrors.InternalServerError({
            error,
            message: "Encountered unexpected error: OIDCAuthenticationServiceImpl#authenticate",
          }),
      ),
    )
  }
}
