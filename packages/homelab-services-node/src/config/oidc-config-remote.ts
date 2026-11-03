import { Console, Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { Config, Schemas } from "homelab-services"

export const RemoteOIDCWellKnownDetailsServiceLive = Layer.effect(
  Config.OIDCConfigRemote.RemoteOIDCWellKnownDetailsService,
  Effect.gen(function*() {
    const kanidmUrl = yield* Config.Env.kanidmOidcUrl

    const kanidmConfig = yield* HttpClient.get(kanidmUrl).pipe(
      Effect.filterOrElse(
        (res) => res.status >= 200 && res.status < 300,
        (res) =>
          res.text.pipe(
            Effect.map((res) => `Failed to fetch Kanidm OIDC configuration: ${res}`),
            Effect.andThen(Effect.die),
          ),
      ),
      Effect.andThen(
        HttpClientResponse.schemaBodyJson(Schemas.OIDC.OIDCWellKnown),
      ),
      Effect.tapError(Console.error),
      Effect.option,
    )

    return {
      kanidm: kanidmConfig,
    }
  }),
)
