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

const DNS_URL = new URL(`${BASE_URL}/mobile-config/dns/private_homelab`)

describe("GET /mobile-config/dns/:profile", () => {
  describe("authorization", () => {
    it.live("rejects a request with insufficient permissions", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const { access_token, nonce, token_type } = yield* getToken(TEST_LIMITED_API_KEY)

        const dpopProof = yield* createToken({
          htu: DNS_URL,
          htm: "GET",
          nonce,
          accessToken: access_token,
        })

        const result = yield* Effect.flip(
          client["mobile-config"].dns({
            params: { profile: "private_homelab" },
            query: {},
            headers: {
              dpop: dpopProof,
              authorization: `${token_type} ${access_token}`,
            },
          }),
        )

        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${JSON.stringify(result)}`,
        )
      }).pipe(Effect.provide(E2ETestLayer)))
  })

  describe("validation", () => {
    it.live("rejects private_homelab_resolver_only without ssid", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient
        const resolverUrl = new URL(`${BASE_URL}/mobile-config/dns/private_homelab_resolver_only`)

        const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)

        const dpopProof = yield* createToken({
          htu: resolverUrl,
          htm: "GET",
          nonce,
          accessToken: access_token,
        })

        const result = yield* Effect.flip(
          client["mobile-config"].dns({
            params: { profile: "private_homelab_resolver_only" },
            query: {},
            headers: {
              dpop: dpopProof,
              authorization: `${token_type} ${access_token}`,
            },
          }),
        )

        assert(
          result instanceof ApiErrors.BadRequest,
          `Expected BadRequest, got ${JSON.stringify(result)}`,
        )
      }).pipe(Effect.provide(E2ETestLayer)))
  })

  describe("success", () => {
    it.live("returns a DNS mobileconfig profile", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)

        const dpopProof = yield* createToken({
          htu: DNS_URL,
          htm: "GET",
          nonce,
          accessToken: access_token,
        })

        const result = yield* client["mobile-config"].dns({
          params: { profile: "private_homelab" },
          query: {},
          headers: {
            dpop: dpopProof,
            authorization: `${token_type} ${access_token}`,
          },
        })

        expect(result).toContain("<?xml")
        expect(result).toContain("plist")
      }).pipe(Effect.provide(E2ETestLayer)))
  })
})
