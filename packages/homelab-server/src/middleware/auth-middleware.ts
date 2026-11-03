import { Array, Effect, flow, Layer, Option, Result, String } from "effect"
import { Headers, HttpServerRequest } from "effect/http"
import { ApiErrors, Config, Middleware, type Schemas, Services } from "homelab-services"

const extractBearerTokens: (authHeader: string) => ReadonlyArray<Buffer> =
  // effect joins multiple http headers with commas:
  // https://github.com/Effect-TS/effect/blob/ec5c50507b1a2f5ad712c148a7da0fadb8cb9f52/packages/platform/src/Headers.ts#L109
  flow(
    String.split(", "),
    Array.filterMap(
      flow(
        String.match(/^(Bearer|DPoP) (.*)$/),
        Option.flatMap(
          Array.get(2),
        ),
        Option.map(String.trim),
        Option.filter(
          String.isNonEmpty,
        ),
        Option.map(
          (_) => Buffer.from(_, "utf8"),
        ),
        Result.fromOption(() => undefined),
      ),
    ),
  )

const extractDPopTokens: (dpopHeader: string) => ReadonlyArray<string> = flow(
  String.split(", "),
  Array.filterMap(
    flow(
      String.trim,
      Option.liftPredicate(
        String.isNonEmpty,
      ),
      Result.fromOption(() => undefined),
    ),
  ),
)

export const AuthMiddlewareLive = Layer.effect(
  Middleware.AuthMiddleware,
  Effect.gen(function*() {
    const authService = yield* Services.AuthenticationService.AuthenticationService
    const claimCheckService = yield* Services.ClaimCheckService.ClaimCheckService
    const origin = yield* Config.Env.originUrl

    // @effect-diagnostics returnEffectInGen:off
    const middleware: typeof Middleware.AuthMiddleware.Service = (httpEffect) =>
      Effect.gen(function*() {
        const request = yield* HttpServerRequest.HttpServerRequest

        const claimCheck = yield* Effect.try({
          try() {
            return Option.gen(function*() {
              const query = yield* Option.fromNullishOr(request.url.split("?")[1] ?? null)

              const urlParams = new URLSearchParams(query)

              return yield* Option.fromNullishOr(urlParams.get("claim_check"))
            })
          },
          catch(error) {
            return new ApiErrors.InternalServerError({
              error,
              message: "Unexpectedly failed to parse request URL",
            })
          },
        })

        const identity = Option.isSome(claimCheck)
          ? yield* claimCheckService.validate(claimCheck.value)
          : yield* Effect.gen(function*() {
            const bearerTokens = Headers.get(request.headers, "authorization").pipe(
              Option.map(extractBearerTokens),
            )

            if (
              Option.match(bearerTokens, {
                onNone: () => false,
                onSome: (tokens) => tokens.length > 1,
              })
            ) {
              return yield* new ApiErrors.AuthenticationError({
                reason: "invalid-credential",
                message: `Recieved Empty or Numerous Bearer Tokens`,
              })
            }

            const jwt = bearerTokens.pipe(
              Option.flatMap(Array.get(0)),
            )

            const dpopTokens = Headers.get(request.headers, "dpop").pipe(
              Option.andThen(extractDPopTokens),
              Option.getOrElse(() => Array.empty<string>()),
            )

            const htu = new URL(request.url, origin)
            const htm = request.method as Schemas.HTTPMethod.HTTPMethod

            return yield* authService.authenticate(jwt, htu, htm, dpopTokens)
              .pipe(
                Effect.catchTags({
                  NonceValidationError(error) {
                    return new ApiErrors.AuthenticationError({
                      reason: "invalid-credential",
                      message: "Failed to validate nonce",
                      error,
                    })
                  },
                  HMACDigestError(error) {
                    return new ApiErrors.InternalServerError({
                      message: "HMAC error during authentication",
                      error,
                    })
                  },
                }),
              )
          })

        return yield* Effect.provideService(httpEffect, Middleware.CurrentIdentity, identity)
      })

    return middleware
  }),
)
