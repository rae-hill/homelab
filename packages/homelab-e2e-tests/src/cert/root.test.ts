import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { ApiErrors } from "homelab-services"
import {
  BASE_URL,
  createToken,
  E2ETestLayer,
  getToken,
  makeApiClient,
  TEST_API_KEY,
  TEST_LIMITED_API_KEY,
} from "../../test-utils/index.js"

const ROOT_DER_URL = new URL(`${BASE_URL}/cert/root/der`)
const ROOT_CRT_URL = new URL(`${BASE_URL}/cert/root/crt`)

describe("GET /cert/root/:format", () => {
  describe("authorization", () => {
    it.live("rejects a request with insufficient permissions", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient
        const { access_token, nonce, token_type } = yield* getToken(TEST_LIMITED_API_KEY)
        const dpopProof = yield* createToken({
          htu: ROOT_DER_URL,
          htm: "GET",
          nonce,
          accessToken: access_token,
        })
        const result = yield* Effect.flip(
          client.cert.root({
            params: { format: "der" },
            headers: { dpop: dpopProof, authorization: `${token_type} ${access_token}` },
          }),
        )
        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
      }).pipe(Effect.provide(E2ETestLayer)))
  })

  describe("success", () => {
    it.live("returns root certificate in DER format", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient
        const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)
        const dpopProof = yield* createToken({
          htu: ROOT_DER_URL,
          htm: "GET",
          nonce,
          accessToken: access_token,
        })
        const result = yield* client.cert.root({
          params: { format: "der" },
          headers: { dpop: dpopProof, authorization: `${token_type} ${access_token}` },
        })
        expect(result).toBeInstanceOf(Uint8Array)
        expect(result.length).toBeGreaterThan(0)
      }).pipe(Effect.provide(E2ETestLayer)))

    it.live("returns root certificate in CRT format", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient
        const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)
        const dpopProof = yield* createToken({
          htu: ROOT_CRT_URL,
          htm: "GET",
          nonce,
          accessToken: access_token,
        })
        const result = yield* client.cert.root({
          params: { format: "crt" },
          headers: { dpop: dpopProof, authorization: `${token_type} ${access_token}` },
        })
        expect(result).toBeInstanceOf(Uint8Array)
        expect(result.length).toBeGreaterThan(0)
      }).pipe(Effect.provide(E2ETestLayer)))
  })
})
