import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { ApiErrors } from "homelab-services"
import {
  BASE_URL,
  createToken,
  E2ETestLayer,
  getToken,
  makeApiClient,
  TEST_API_KEY,
  TEST_LIMITED_CERTS_KEY,
} from "../../test-utils/index.js"

const CERTS_URL = new URL(`${BASE_URL}/mobile-config/certs`)

describe("GET /mobile-config/certs", () => {
  describe("authorization", () => {
    it.live("rejects an unauthorized request", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const { access_token, nonce, token_type } = yield* getToken(TEST_LIMITED_CERTS_KEY)

        const newDpopProof = yield* createToken({
          htu: CERTS_URL,
          htm: "GET",
          nonce,
          accessToken: access_token,
        })

        const result = yield* Effect.flip(
          client["mobile-config"].certs({
            query: {},
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

        expect(result.message).toBe(
          "guest-b@a.plato-splunk.media (OIDC) is not allowed to perform view on Config_Certs",
        )
      }).pipe(Effect.provide(E2ETestLayer)))
  })

  describe("success", () => {
    it.live("returns the certificate mobileconfig profile", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)

        const newDpopProof = yield* createToken({
          htu: CERTS_URL,
          htm: "GET",
          nonce,
          accessToken: access_token,
        })

        const result = yield* client["mobile-config"].certs({
          query: {},
          headers: {
            dpop: newDpopProof,
            authorization: `${token_type} ${access_token}`,
          },
        })

        expect(result).toBeDefined()
      }).pipe(Effect.provide(E2ETestLayer)))

    it.live("allows guests to get cert profiles", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const result = yield* client["mobile-config"].certs({
          query: {},
          headers: {},
        })

        expect(result).toBeDefined()
      }).pipe(Effect.provide(E2ETestLayer)))
  })
})
