import { Array, DateTime, Effect, Layer, Option, pipe, Schema } from "effect"
import { ApiErrors, Config, Identity, Schemas, Services } from "homelab-services"
import { Constants } from "homelab-shared"
import { decodeJwt, SignJWT } from "jose"
import * as Crypto from "node:crypto"

export const TokenIssuerServiceLive = Layer.effect(
  Services.TokenIssuerService.TokenIssuerService,
  Effect.gen(function*() {
    const origin = yield* Config.Env.originUrl

    const [issuer, [publicKey, privateKey]] = yield* Config.IssuerJwkResolver.getJwkKeyPair(origin.href).pipe(
      Effect.andThen(
        Option.match({
          onSome(jwk) {
            return Effect.succeed([origin.href, jwk] as const)
          },
          onNone() {
            return Effect.fail(
              new ApiErrors.InternalServerError({
                message: "Token issuer JWK not found for origin",
              }),
            )
          },
        }),
      ),
    )

    const kid = yield* Option.fromNullishOr(publicKey.kid).pipe(
      Option.match({
        onNone: () => Effect.die(new globalThis.Error("Public signing key missing KID")),
        onSome: Effect.succeed,
      }),
    )

    return new TokenIssuerServiceImpl(
      issuer,
      publicKey.alg,
      kid,
      privateKey,
      yield* Config.ApiKeyConfig.ApiKeyConfig,
      yield* Services.DPoPTokenValidatorService.DPoPTokenValidatorService,
      yield* Services.NonceService.NonceService,
    )
  }),
)

class TokenIssuerServiceImpl implements Services.TokenIssuerService.TokenIssuerServiceDef {
  constructor(
    private readonly oidcIssuer: string,
    private readonly alg: string,
    private readonly kid: string,
    private readonly privateJwk: CryptoKey,
    private readonly apiKeyConfig: typeof Config.ApiKeyConfig.ApiKeyConfig.Service,
    private readonly dpopTokenValidator: typeof Services.DPoPTokenValidatorService.DPoPTokenValidatorService.Service,
    private readonly nonceService: typeof Services.NonceService.NonceService.Service,
  ) {}

  issueToken(
    apiKey: Option.Option<string>,
    dpopTokens: ReadonlyArray<string>,
  ) {
    return Effect.gen({ self: this }, function*() {
      const [email, apiKeyScopes] = yield* this.getApiKeyEmailRoles(apiKey)

      const { htm, htu } = yield* this.extractDpop(dpopTokens).pipe(
        Effect.andThen(
          Schema.decodeUnknownEffect(
            Schemas.OAuth.DPoPProofHTTPParams,
          ),
        ),
        Effect.catchTag("SchemaError", (err) =>
          new ApiErrors.AuthenticationError({
            reason: "invalid-credential",
            message: "Received invalid DPoP",
            error: err.toString(),
          })),
      )

      const { headers: { jwk } } = yield* this.dpopTokenValidator.validateDPoPToken(
        htu,
        htm,
        dpopTokens,
      )

      const accessToken = yield* this.signAccessToken(
        jwk,
        Array.fromIterable(apiKeyScopes),
        email,
      )

      const now = yield* DateTime.now
      const nonce = yield* this.nonceService.withTime(now)

      const identity = new Identity.OIDCIdentity(email, apiKeyScopes)

      return { accessToken, nonce, identity }
    })
  }

  private extractDpop(dpopTokens: ReadonlyArray<string>) {
    return pipe(
      dpopTokens,
      Effect.succeed,
      Effect.filterOrFail(
        (tokens): tokens is [string] => tokens.length === 1,
        (tokens) =>
          new ApiErrors.AuthenticationError({
            reason: tokens.length === 0 ? "not-authenticated" : "invalid-credential",
            message: tokens.length === 0 ? "DPoP proof is required" : "Received multiple DPoP tokens",
          }),
      ),
      Effect.flatMap(([dpopToken]) =>
        Effect.try({
          try() {
            return decodeJwt(dpopToken)
          },
          catch(error) {
            return new ApiErrors.AuthenticationError({
              reason: "invalid-credential",
              message: "Failed to decode DPoP token claims",
              error,
            })
          },
        })
      ),
    )
  }

  private getApiKeyEmailRoles(apiKey: Option.Option<string>) {
    return Effect.gen({ self: this }, function*() {
      const providedApiKey = yield* apiKey.pipe(
        Option.map(Effect.succeed),
        Option.getOrElse(() =>
          Effect.fail(
            new ApiErrors.AuthenticationError({
              reason: "not-authenticated",
              message: "API key is required",
            }),
          )
        ),
      )

      const roles = yield* pipe(
        this.apiKeyConfig.getRoles(providedApiKey),
        Option.map(Effect.succeed),
        Option.getOrElse(() =>
          Effect.fail(
            new ApiErrors.AuthenticationError({
              reason: "invalid-credential",
              message: "Invalid API Key",
            }),
          )
        ),
      )

      const email = yield* pipe(
        this.apiKeyConfig.getEmail(providedApiKey),
        Option.map(Effect.succeed),
        Option.getOrElse(() =>
          Effect.fail(
            new ApiErrors.AuthenticationError({
              reason: "invalid-credential",
              message: "Invalid API Key",
            }),
          )
        ),
      )

      return [
        email,
        roles,
      ] as const
    })
  }

  private signAccessToken(dpopJwk: Schemas.OAuth.JWK, roles: ReadonlyArray<string>, email: string) {
    return Effect.gen({ self: this }, function*() {
      const dpopJwkDigest = yield* Effect.try({
        try() {
          return Crypto.hash("sha256", JSON.stringify(dpopJwk))
        },
        catch(error) {
          return new ApiErrors.InternalServerError({
            error,
            message: "Failed to create DPoP thumbprint",
          })
        },
      })

      const nowUnixS = yield* DateTime.now.pipe(
        Effect.map(
          DateTime.toEpochMillis,
        ),
        Effect.map(
          (_) => _ / Constants.MS_PER_S,
        ),
      )

      const expiresIn = Constants.ONE_HOUR_SECONDS

      const jwt = yield* Effect.tryPromise({
        try: () => {
          const jwt = new SignJWT({
            cnf: {
              jkt: dpopJwkDigest,
            },
            [Constants.JWT_ROLES_KEY]: roles,
            email,
          })
            .setProtectedHeader({ alg: this.alg, kid: this.kid })
            .setIssuedAt(nowUnixS)
            .setIssuer(this.oidcIssuer)
            .setAudience(Constants.JWT_HOMELAB_API_AUD)
            .setExpirationTime(nowUnixS + expiresIn)
            .sign(this.privateJwk)

          return jwt
        },
        catch: (error) =>
          new ApiErrors.InternalServerError({
            message: "Failed to sign JWT",
            error,
          }),
      })

      return jwt
    })
  }
}
