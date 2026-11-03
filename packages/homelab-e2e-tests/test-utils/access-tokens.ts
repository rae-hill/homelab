import { Effect, Option } from "effect"
import { type HttpClient } from "effect/http"
import { Homelab } from "homelab-api"
import { type Schemas } from "homelab-services"
import * as Crypto from "node:crypto"
import { BASE_URL, makeApiClient } from "./api-client.js"
import { createToken, type DPoPTokenCreatorService } from "./dpop-tokens.js"
import { callWithHeaders } from "./utils.js"

export type GetTokenResult = typeof Schemas.Token.TokenResponse.Type & { readonly nonce: string }

export const getToken = (apiKey: string): Effect.Effect<
  GetTokenResult,
  unknown,
  HttpClient.HttpClient | DPoPTokenCreatorService
> =>
  Effect.gen(function*() {
    const tokenUrl = new URL(Homelab.OAuthEndpoints.Token.TokenEndpoint.path, BASE_URL)
    const dpopProof = yield* createToken({ htu: tokenUrl, htm: "POST" })
    const apiKeyB64 = Buffer.from(`:${apiKey}`).toString("base64url")

    const apiClient = yield* makeApiClient

    const [tokenResponse, res] = yield* apiClient.oauth.token({
      responseMode: "decoded-and-response",
      headers: {
        dpop: dpopProof,
        authorization: apiKeyB64,
      },
    })

    const nonce = yield* Option.fromNullishOr(res.headers["dpop-nonce"]).pipe(
      Option.match({
        onNone: () => Effect.die(new globalThis.Error("Nonce not returned from token endpoint")),
        onSome: Effect.succeed,
      }),
    )

    return { ...tokenResponse, nonce }
  })

export const makeAccessTokenDPoP = (
  accessToken: string,
  nonce: string,
  htu: URL,
  htm: "GET" | "PUT" | "POST",
) =>
  Effect.gen(function*() {
    const ath = Crypto.createHash("sha256").update(accessToken, "ascii").digest("base64url")
    return yield* createToken({ htu, htm, nonce, ath })
  })

export const withAccessTokenAuth = <A, E, R>(
  accessToken: string,
  nonce: string,
  htu: URL,
  htm: "GET" | "PUT" | "POST",
  effect: Effect.Effect<A, E, R | HttpClient.HttpClient>,
) =>
  Effect.gen(function*() {
    const dpopProof = yield* makeAccessTokenDPoP(accessToken, nonce, htu, htm)
    return yield* callWithHeaders(
      { Authorization: `DPoP ${accessToken}`, DPoP: dpopProof },
      effect,
    )
  })
