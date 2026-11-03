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

const CLAIM_CHECK_URL = new URL(`${BASE_URL}/oauth/claim-check`)

describe("POST /oauth/claim-check", () => {
  describe("authorization", () => {
    it.live("rejects an unauthenticated request", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const result = yield* Effect.flip(
          client.oauth["claim-check"]({
            headers: {},
          }),
        )

        assert(
          result instanceof ApiErrors.AuthorizationError,
          `expected instanceof ApiErrors.AuthorizationError but got ${JSON.stringify(result)}`,
        )
        expect(result.message).toBe(
          "guest (Guest) is not allowed to perform view on OAuth_ClaimCheck",
        )
      }).pipe(Effect.provide(E2ETestLayer)))

    it.live("rejects an unauthorized request", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const { access_token, nonce, token_type } = yield* getToken(TEST_LIMITED_API_KEY)

        const newDpopProof = yield* createToken({
          htu: CLAIM_CHECK_URL,
          htm: "POST",
          nonce,
          accessToken: access_token,
        })

        const result = yield* Effect.flip(
          client.oauth["claim-check"]({
            headers: {
              dpop: newDpopProof,
              authorization: `${token_type} ${access_token}`,
            },
          }),
        )

        assert(
          result instanceof ApiErrors.AuthorizationError,
          `expected instanceof ApiErrors.AuthorizationError but got ${JSON.stringify(result)}`,
        )
      }).pipe(Effect.provide(E2ETestLayer)))
  })

  describe("success", () => {
    it.live("issues a claim check for an authorized identity", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)

        const newDpopProof = yield* createToken({
          htu: CLAIM_CHECK_URL,
          htm: "POST",
          nonce,
          accessToken: access_token,
        })

        const result = yield* client.oauth["claim-check"]({
          headers: {
            dpop: newDpopProof,
            authorization: `${token_type} ${access_token}`,
          },
        })

        expect(result.claim_check).toBeTypeOf("string")
        expect(result.claim_check.length).toBeGreaterThan(0)
      }).pipe(Effect.provide(E2ETestLayer)))

    it.live("claim check grants access to a protected endpoint", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)

        const dpopProof = yield* createToken({
          htu: CLAIM_CHECK_URL,
          htm: "POST",
          nonce,
          accessToken: access_token,
        })

        const { claim_check } = yield* client.oauth["claim-check"]({
          headers: {
            dpop: dpopProof,
            authorization: `${token_type} ${access_token}`,
          },
        })

        const result = yield* client["mobile-config"].certs({
          query: { claim_check },
          headers: {},
        })

        expect(result).toBeDefined()
      }).pipe(Effect.provide(E2ETestLayer)))
  })
})
