import { Effect } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { Homelab } from "homelab-api"
import { Schemas } from "homelab-services"
import { API_BASE_URL } from "../env.js"
import * as Storage from "../storage/index.js"
import { PKCE_STATE_KEY, PKCE_VERIFIER_KEY, RETURN_URL_KEY } from "./constants.js"
import { OIDC_CLIENT_ID, OIDC_REDIRECT_PATH, OIDC_WELL_KNOWN_URL } from "./env.js"
import { TokenResponse } from "./schema.js"
import { generatePKCE, generateRandomString } from "./utils.js"

const getRedirectUri = () => `${window.location.origin}${OIDC_REDIRECT_PATH}`

export const fetchOIDCWellKnown = Effect.fn("fetchOIDCWellKnown")(function*() {
  const wellKnownUrl = yield* OIDC_WELL_KNOWN_URL

  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.transformResponse(Effect.provideService(HttpClient.TracerPropagationEnabled, false)),
  )
  const response = yield* client.execute(HttpClientRequest.get(wellKnownUrl))
  return yield* HttpClientResponse.schemaBodyJson(Schemas.OIDC.OIDCWellKnown)(response)
})

export const login = Effect.fn("login")(function*() {
  const storage = yield* Storage.Service.StorageService
  const clientId = yield* OIDC_CLIENT_ID
  const wk = yield* fetchOIDCWellKnown()
  const { codeChallenge, codeVerifier } = yield* generatePKCE()
  const state = yield* generateRandomString(32)

  yield* storage.set(PKCE_VERIFIER_KEY, codeVerifier)
  yield* storage.set(PKCE_STATE_KEY, state)
  yield* storage.set(RETURN_URL_KEY, window.location.href)

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    scope: "openid profile email",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  })

  yield* Effect.sync(() => {
    window.location.href = `${wk.authorizationEndpoint}?${params}`
  })
})

export const handleOIDCCallback = Effect.fn("handleOIDCCallback")(function*() {
  const storage = yield* Storage.Service.StorageService
  const clientId = yield* OIDC_CLIENT_ID

  const urlParams = new URLSearchParams(window.location.search)
  const code = urlParams.get("code")
  const state = urlParams.get("state")
  const savedState = yield* storage.get(PKCE_STATE_KEY).pipe(
    Effect.map((_) => _.pipe((_) => _._tag === "Some" ? _.value : null)),
  )
  const codeVerifier = yield* storage.get(PKCE_VERIFIER_KEY).pipe(Effect.map((_) => _._tag === "Some" ? _.value : null))

  if (!code || !state || state !== savedState || !codeVerifier) {
    return yield* Effect.fail(
      new Error(
        `Invalid OIDC callback: code=${!!code}, state=${!!state}, stateMatch=${
          state === savedState
        }, verifier=${!!codeVerifier}`,
      ),
    )
  }

  yield* storage.remove(PKCE_VERIFIER_KEY)
  yield* storage.remove(PKCE_STATE_KEY)

  const wk = yield* fetchOIDCWellKnown()
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.transformResponse(Effect.provideService(HttpClient.TracerPropagationEnabled, false)),
  )

  const response = yield* client.execute(
    HttpClientRequest.post(wk.tokenEndpoint).pipe(
      HttpClientRequest.bodyUrlParams({
        grant_type: "authorization_code",
        client_id: clientId,
        redirect_uri: getRedirectUri(),
        code,
        code_verifier: codeVerifier,
      }),
    ),
  )

  return yield* HttpClientResponse.schemaBodyJson(TokenResponse)(response)
})

export const consumeReturnUrl = Effect.fn("consumeReturnUrl")(function*() {
  const storage = yield* Storage.Service.StorageService
  const url = yield* storage.get(RETURN_URL_KEY).pipe(Effect.map((_) => _._tag === "Some" ? _.value : "/"))
  yield* storage.remove(RETURN_URL_KEY)
  return url
})

export const fetchSelf = Effect.fn("fetchSelf")(function*(token: string) {
  const apiBaseUrl = yield* API_BASE_URL
  const client = yield* HttpApiClient.make(Homelab.HomelabApi, { baseUrl: apiBaseUrl })
  return yield* client.status.self({
    headers: { authorization: `Bearer ${token}` },
  })
})
