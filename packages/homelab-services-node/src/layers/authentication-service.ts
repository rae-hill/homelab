import { Effect, Layer, Option } from "effect"
import { ApiErrors, Config, Identity, Services } from "homelab-services"
import type { Schemas } from "homelab-services"
import type { JWTVerifyGetKey } from "jose"
import { decodeJwt } from "jose"
import { OIDCAuthenticationServiceLive } from "./oidc-authentication-service.js"

export const AuthenticationServiceLive = Layer.effect(
  Services.AuthenticationService.AuthenticationService,
  Effect.gen(function*() {
    return new AuthenticationServiceImpl(
      yield* Services.OIDCAuthenticationService.OIDCAuthenticationService,
      yield* Config.IssuerJwkResolver.IssuerJwkResolver,
      yield* Services.DPoPTokenValidatorService.DPoPTokenValidatorService,
    )
  }),
).pipe(
  Layer.provide(OIDCAuthenticationServiceLive),
)

class AuthenticationServiceImpl implements Services.AuthenticationService.AuthenticationServiceDef {
  constructor(
    private readonly oidcService: typeof Services.OIDCAuthenticationService.OIDCAuthenticationService.Service,
    private readonly issuerJwkResolver: typeof Config.IssuerJwkResolver.IssuerJwkResolver.Service,
    private readonly dpopValidator: typeof Services.DPoPTokenValidatorService.DPoPTokenValidatorService.Service,
  ) {}

  authenticate(
    jwt: Option.Option<Buffer>,
    expectedHtu: URL,
    expectedHtm: Schemas.HTTPMethod.HTTPMethod,
    dpopTokens: ReadonlyArray<string>,
  ): Effect.Effect<
    Identity.Identity,
    | ApiErrors.AuthenticationError
    | ApiErrors.BadRequest
    | ApiErrors.InternalServerError
    | Services.NonceService.NonceValidationError
    | Services.HMACService.HMACDigestError
  > {
    return Option.match(
      jwt,
      {
        onNone() {
          return Effect.succeed(new Identity.GuestIdentity())
        },
        onSome: (jwt) =>
          Effect.gen({ self: this }, function*() {
            const issuer = yield* this.getJwtIssuer(jwt)
            const jwkKey = yield* this.getJwkKey(issuer)

            if (this.issuerJwkResolver.isLocalIssuer(issuer)) {
              yield* this.dpopValidator.validateDPoPToken(
                expectedHtu,
                expectedHtm,
                dpopTokens,
                jwt.toString("utf8"),
                true,
              )
            }

            return yield* this.oidcService.authorizeOIDC(jwt, jwkKey, issuer)
          }),
      },
    )
  }

  private getJwkKey(issuer: string): Effect.Effect<JWTVerifyGetKey, ApiErrors.AuthenticationError> {
    return this.issuerJwkResolver.getJwkKeyVerifier(issuer).pipe(
      Option.match({
        onNone: () =>
          new ApiErrors.AuthenticationError({
            reason: "unrecognized-issuer",
            message: `Issuer not recognized: ${issuer}`,
          }),
        onSome: Effect.succeed,
      }),
    )
  }

  private getJwtIssuer(jwt: Buffer): Effect.Effect<string, ApiErrors.AuthenticationError> {
    return Effect.try({
      try() {
        const decoded = decodeJwt(jwt.toString("utf8"))

        return decoded.iss
      },
      catch(error) {
        return new ApiErrors.AuthenticationError({
          reason: "invalid-credential",
          message: `Failed to decode JWT`,
          error,
        })
      },
    }).pipe(
      Effect.andThen((iss) =>
        Effect.fromOption(
          Option.fromNullishOr(iss),
          () =>
            new ApiErrors.AuthenticationError({
              reason: "invalid-claims",
              message: "JWT is missing issuer claim",
            }),
        )
      ),
    )
  }
}
