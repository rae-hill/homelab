import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { ApiErrors } from "homelab-services"
import {
  BASE_URL,
  createToken,
  E2ETestLayer,
  makeApiClient,
  makeTestDPoPWithoutJwk,
  TEST_API_KEY,
} from "../../test-utils/index.js"

const TOKEN_URL = new URL(`${BASE_URL}/oauth/token`)

describe("POST /oauth/token", () => {
  describe("authentication failures", () => {
    it.live("does't permit missing api key", () =>
      Effect.gen(function*() {
        const apiClient = yield* makeApiClient

        const res = yield* Effect.flip(
          apiClient.oauth.token({
            headers: {},
          }),
        )

        assert(
          res instanceof ApiErrors.AuthenticationError,
          `expected instanceof ApiErrors.AuthenticationError but got ${JSON.stringify(res)}`,
        )

        expect(res.message).toBe("API key is required")
      }).pipe(Effect.provide(E2ETestLayer)))
    it.live("rejects a request with an unrecognized API key", () =>
      Effect.gen(function*() {
        const apiClient = yield* makeApiClient
        const dpopProof = yield* createToken({ htu: TOKEN_URL, htm: "POST" })
        const apiKeyB64 = Buffer.from(`:api-key-12345`).toString("base64url")

        const res = yield* Effect.flip(
          apiClient.oauth.token({
            headers: {
              dpop: dpopProof,
              authorization: `${apiKeyB64}`,
            },
          }),
        )

        assert(
          res instanceof ApiErrors.AuthenticationError,
          `expected instanceof ApiErrors.AuthenticationError but got ${JSON.stringify(res)}`,
        )

        expect(res.message).toBe("Invalid API Key")
      }).pipe(Effect.provide(E2ETestLayer)))

    it.live("rejects a request with a malformed DPoP proof", () =>
      Effect.gen(function*() {
        const apiClient = yield* makeApiClient
        const dpopProof = yield* makeTestDPoPWithoutJwk(TOKEN_URL, "POST")
        const apiKeyB64 = Buffer.from(`:${TEST_API_KEY}`).toString("base64url")

        const res = yield* Effect.flip(
          apiClient.oauth.token({
            headers: {
              dpop: dpopProof,
              authorization: `${apiKeyB64}`,
            },
          }),
        )

        assert(
          res instanceof ApiErrors.AuthenticationError,
          `expected instanceof ApiErrors.AuthenticationError but got ${JSON.stringify(res)}`,
        )

        expect(res.message).toBe("DPoP header missing JWK")
      }).pipe(Effect.provide(E2ETestLayer)))
  })

  describe("success", () => {
    it.live("issues a DPoP-bound access token and returns DPoP-Nonce header", () =>
      Effect.gen(function*() {
        const apiClient = yield* makeApiClient
        const dpopProof = yield* createToken({ htu: TOKEN_URL, htm: "POST" })
        const apiKeyB64 = Buffer.from(`:${TEST_API_KEY}`).toString("base64url")

        const [{ access_token, token_type }, res] = yield* apiClient.oauth.token({
          responseMode: "decoded-and-response",
          headers: {
            dpop: dpopProof,
            authorization: `${apiKeyB64}`,
          },
        })

        const nonce = res.headers["dpop-nonce"]

        expect(access_token).toBeTypeOf("string")
        expect(access_token.length).toBeGreaterThan(0)
        expect(token_type).toBe("DPoP")
        expect(nonce).toBeTypeOf("string")
        expect(nonce.length).toBeGreaterThan(0)
      }).pipe(Effect.provide(E2ETestLayer)))
  })
})
