import { ConfigProvider, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { onMount } from "solid-js"
import * as Lib from "../lib/index.js"
import { FullPageSpinner } from "./FullPageSpinner/index.js"
import { showErrorToast } from "./Toast/index.js"

const RuntimeLayer = Layer.mergeAll(FetchHttpClient.layer, Lib.Storage.SessionStorage.SessionStorageServiceLive)

export function OAuthCallback() {
  onMount(() => {
    const program = Effect.gen(function*() {
      const tokenResponse = yield* Lib.Auth.Effects.handleOIDCCallback()
      Lib.Auth.State.setAuth(tokenResponse)
      const returnUrl = yield* Lib.Auth.Effects.consumeReturnUrl()
      yield* Effect.sync(() => {
        window.location.href = returnUrl
      })
    })

    Effect.runPromise(
      program.pipe(
        Effect.provide(RuntimeLayer),
        Effect.provideService(ConfigProvider.ConfigProvider, Lib.Env.AstroConfigProvider),
      ),
    ).catch((err) => {
      console.error("[OAuthCallback] error:", err)
      showErrorToast(err instanceof Error ? err.message : "Authentication failed")
    })
  })

  return <FullPageSpinner />
}
