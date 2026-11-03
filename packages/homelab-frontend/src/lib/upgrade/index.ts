import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { UPGRADE_STATUS_URL, UPGRADE_TARGET_ORIGIN } from "../env.js"

export const upgradeIfReachable = Effect.fn("upgradeIfReachable")(function*(preRedirect: () => void) {
  const statusUrl = yield* UPGRADE_STATUS_URL
  const targetOrigin = yield* UPGRADE_TARGET_ORIGIN

  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

  yield* client.execute(HttpClientRequest.get(statusUrl)).pipe(
    Effect.tap(() => Effect.sync(preRedirect)),
    Effect.timeout("3 seconds"),
    Effect.andThen(() =>
      Effect.sync(() => {
        const target = new URL(window.location.pathname, targetOrigin)
        target.search = window.location.search
        window.location.replace(target.toString())
      })
    ),
  )
})
