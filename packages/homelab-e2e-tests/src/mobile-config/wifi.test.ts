import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
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

export const wifiUrl = (ssid: string, encryption: "WPA3" | "WPA2") =>
  new URL(`${BASE_URL}/mobile-config/wifi/${ssid}/${encryption}`)

describe("PUT /mobile-config/wifi/:ssid/:encryption", () => {
  describe("authorization", () => {
    it.live("rejects an unauthorized request", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const { access_token, nonce, token_type } = yield* getToken(TEST_LIMITED_API_KEY)

        const newDpopProof = yield* createToken({
          htu: wifiUrl("abcd", "WPA2"),
          htm: "PUT",
          nonce,
          accessToken: access_token,
        })

        const result = yield* Effect.flip(
          client["mobile-config"].wifi({
            payload: {
              enterpriseClientType: "None",
              disableMACRandomization: false,
              password: "1234",
            },
            params: {
              ssid: "abcd",
              encryption: "WPA2",
            },
            headers: {
              dpop: newDpopProof,
              authorization: `${token_type} ${access_token}`,
            },
            query: {},
          }),
        )

        assert(
          result instanceof ApiErrors.AuthorizationError,
          `expected instanceof ApiErrors.AuthorizationError but got ${JSON.stringify(result)}`,
        )

        expect(result.message).toBe(
          "guest-a@a.plato-splunk.media (OIDC) is not allowed to perform view on Config_Wifi",
        )
      }).pipe(Effect.provide(E2ETestLayer)))
  })

  describe("error cases", () => {
    it.live("rejects EAP-TLS enterprise client type from unrecognized IP", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)

        const newDpopProof = yield* createToken({
          htu: wifiUrl("abcd", "WPA2"),
          htm: "PUT",
          nonce,
          accessToken: access_token,
        })

        const result = yield* Effect.flip(
          client["mobile-config"].wifi({
            payload: {
              disableMACRandomization: false,
              enterpriseClientType: "EAP-TLS",
              includeEthernetProfile: false,
            },
            params: {
              ssid: "abcd",
              encryption: "WPA2",
            },
            headers: {
              dpop: newDpopProof,
              authorization: `${token_type} ${access_token}`,
              "x-forwarded-for": "10.0.0.99" as any,
            },
            query: {},
          }),
        )

        assert(
          result instanceof ApiErrors.AuthorizationError,
          `expected instanceof ApiErrors.AuthorizationError but got ${JSON.stringify(result)}`,
        )

        expect(result.message).toBe("IP address not recognized")
      }).pipe(Effect.provide(E2ETestLayer)))

    it.live("rejects PEAP enterprise type when username is missing", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)

        const newDpopProof = yield* createToken({
          htu: wifiUrl("abcd", "WPA2"),
          htm: "PUT",
          nonce,
          accessToken: access_token,
        })

        const result = yield* Effect.flip(
          client["mobile-config"].wifi({
            payload: {
              disableMACRandomization: false,
              password: "1234",
              enterpriseClientType: "PEAP",
            } as any,
            params: {
              ssid: "abcd",
              encryption: "WPA2",
            },
            headers: {
              dpop: newDpopProof,
              authorization: `${token_type} ${access_token}`,
            },
            query: {},
          }),
        )

        assert(
          result instanceof Schema.SchemaError,
          `expected instanceof SchemaError but got ${JSON.stringify(result)}`,
        )
      }).pipe(Effect.provide(E2ETestLayer)))
    it.live("rejects when username does not match Idenitity", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)

        const newDpopProof = yield* createToken({
          htu: wifiUrl("abcd", "WPA2"),
          htm: "PUT",
          nonce,
          accessToken: access_token,
        })

        const result = yield* Effect.flip(client["mobile-config"].wifi({
          payload: {
            disableMACRandomization: false,
            password: "1234",
            enterpriseClientType: "PEAP",
            includeEthernetProfile: false,
            username: "bob",
          },
          params: {
            ssid: "abcd",
            encryption: "WPA2",
          },
          headers: {
            dpop: newDpopProof,
            authorization: `${token_type} ${access_token}`,
          },
          query: {},
        }))

        assert(
          result instanceof ApiErrors.AuthorizationError,
          `expected instanceof ApiErrors.AuthorizationError but got ${JSON.stringify(result)}`,
        )

        expect(result.message).toBe("User's principle identifer must match the requested username")
      }).pipe(Effect.provide(E2ETestLayer)))
  })

  describe("success", () => {
    it.live("returns a WPA3 personal wifi mobileconfig profile", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)

        const newDpopProof = yield* createToken({
          htu: wifiUrl("0x676179", "WPA2"),
          htm: "PUT",
          nonce,
          accessToken: access_token,
        })

        const result = yield* client["mobile-config"].wifi({
          payload: {
            disableMACRandomization: false,
            password: "1234",
            enterpriseClientType: "PEAP",
            includeEthernetProfile: false,
            username: "test",
          },
          params: {
            ssid: "0x676179",
            encryption: "WPA2",
          },
          headers: {
            dpop: newDpopProof,
            authorization: `${token_type} ${access_token}`,
          },
          query: {},
        })

        expect(result).toBeDefined()
      }).pipe(Effect.provide(E2ETestLayer)))

    it.live("restricts guest users to guest account", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const result = yield* Effect.flip(client["mobile-config"].wifi({
          payload: {
            disableMACRandomization: false,
            password: "1234",
            enterpriseClientType: "PEAP",
            includeEthernetProfile: false,
            username: "test",
          },
          params: {
            ssid: "0x676179",
            encryption: "WPA2",
          },
          headers: {},
          query: {},
        }))

        assert(
          result instanceof ApiErrors.AuthorizationError,
          `expected instanceof ApiErrors.AuthorizationError but got ${JSON.stringify(result)}`,
        )
        expect(result.message).toBe("User's principle identifer must match the requested username")
      }).pipe(Effect.provide(E2ETestLayer)))

    it.live("permits guests users to create guest accounts", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const result = yield* client["mobile-config"].wifi({
          payload: {
            disableMACRandomization: false,
            password: "1234",
            enterpriseClientType: "PEAP",
            includeEthernetProfile: false,
            username: "guest",
          },
          params: {
            ssid: "0x676179",
            encryption: "WPA2",
          },
          headers: {},
          query: {},
        })

        expect(result).toBeDefined()
      }).pipe(Effect.provide(E2ETestLayer)))

    it.live("returns an EAP-TLS wifi mobileconfig profile with ACME payload for recognized IP", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)

        const newDpopProof = yield* createToken({
          htu: wifiUrl("0x676179", "WPA3"),
          htm: "PUT",
          nonce,
          accessToken: access_token,
        })

        const result = yield* client["mobile-config"].wifi({
          payload: {
            disableMACRandomization: false,
            enterpriseClientType: "EAP-TLS",
            includeEthernetProfile: false,
          },
          params: {
            ssid: "0x676179",
            encryption: "WPA3",
          },
          headers: {
            dpop: newDpopProof,
            authorization: `${token_type} ${access_token}`,
            "x-forwarded-for": "192.168.1.10" as any,
          },
          query: {},
        })

        expect(result).toContain("<?xml")
        expect(result).toContain("plist")
        expect(result).toContain("ACME")
      }).pipe(Effect.provide(E2ETestLayer)))
  })
})
