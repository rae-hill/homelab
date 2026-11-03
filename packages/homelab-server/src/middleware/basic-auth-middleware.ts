import { Array, Effect, flow, Layer, Option, Redacted, Result, String } from "effect"
import { Headers, HttpServerRequest } from "effect/http"
import { Middleware } from "homelab-services"

const extractBasicPassword: (authHeader: string) => Option.Option<string> = flow(
  Option.some,
  Option.map((encoded) => Buffer.from(encoded, "base64").toString("utf8")),
  Option.map((decoded) => decoded.slice(decoded.indexOf(":") + 1)),
  Option.filter(String.isNonEmpty),
)

const extractDPopTokens: (dpopHeader: string) => ReadonlyArray<string> = flow(
  String.split(", "),
  Array.filterMap(
    flow(
      String.trim,
      Option.liftPredicate(String.isNonEmpty),
      Result.fromOption(() => undefined),
    ),
  ),
)

export const BasicAuthMiddlewareLive = Layer.succeed(
  Middleware.BasicAuthMiddleware,
  {
    apiKey: (httpEffect, { credential }) =>
      Effect.gen(function*() {
        const apiKey = extractBasicPassword(Redacted.value(credential))
        const request = yield* HttpServerRequest.HttpServerRequest
        const dpopTokens = Headers.get(request.headers, "dpop").pipe(
          Option.andThen(extractDPopTokens),
          Option.getOrElse(() => Array.empty<string>()),
        )
        return yield* Effect.provideService(
          httpEffect,
          Middleware.BasicAuthCredentials,
          { apiKey, dpopTokens },
        )
      }),
  },
)
