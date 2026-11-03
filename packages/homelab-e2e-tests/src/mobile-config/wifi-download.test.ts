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
  TEST_LIMITED_API_KEY,
} from "../../test-utils/index.js"

const wifiDownloadUrl = (ssid: string, encryption: "WPA3" | "WPA2") =>
  new URL(`${BASE_URL}/mobile-config/wifi/${ssid}/${encryption}/_download`)

describe("GET /mobile-config/wifi/:ssid/:encryption/_download", () => {
  describe("authorization", () => {
    it.live("rejects an unauthorized request", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const { access_token, nonce, token_type } = yield* getToken(TEST_LIMITED_API_KEY)

        const newDpopProof = yield* createToken({
          htu: wifiDownloadUrl("abcd", "WPA2"),
          htm: "GET",
          nonce,
          accessToken: access_token,
        })

        const result = yield* Effect.flip(
          client["mobile-config"]["wifi-download"]({
            params: {
              ssid: "abcd",
              encryption: "WPA2",
            },
            query: {
              enterpriseClientType: "None",
              password: "1234",
              disableMACRandomization: false,
            },
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
          "guest-a@a.plato-splunk.media (OIDC) is not allowed to perform view on Config_Wifi",
        )
      }).pipe(Effect.provide(E2ETestLayer)))

    it.live("prevents guests from getting non-guest profiles", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const res = yield* Effect.flip(client["mobile-config"]["wifi-download"]({
          params: {
            ssid: "0x676179",
            encryption: "WPA2",
          },
          query: {
            enterpriseClientType: "PEAP",
            username: "foobar",
            password: "1234",
            disableMACRandomization: false,
            includeEthernetProfile: false,
          },
          responseMode: "decoded-and-response",
          headers: {},
        }))

        assert(
          res instanceof ApiErrors.AuthorizationError,
          `expected instanceof ApiErrors.AuthorizationError but got ${JSON.stringify(res)}`,
        )

        expect(res.message).toBe("User's principle identifer must match the requested username")
      }).pipe(Effect.provide(E2ETestLayer)))
  })

  describe("success", () => {
    it.live("returns wifi profile with Content-Disposition attachment header", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const { access_token, nonce, token_type } = yield* getToken(TEST_API_KEY)

        const newDpopProof = yield* createToken({
          htu: wifiDownloadUrl("0x676179", "WPA2"),
          htm: "GET",
          nonce,
          accessToken: access_token,
        })

        const [, res] = yield* client["mobile-config"]["wifi-download"]({
          params: {
            ssid: "0x676179",
            encryption: "WPA2",
          },
          query: {
            enterpriseClientType: "None",
            password: "1234",
            disableMACRandomization: false,
          },
          responseMode: "decoded-and-response",
          headers: {
            dpop: newDpopProof,
            authorization: `${token_type} ${access_token}`,
          },
        })

        const disposition = res.headers["content-disposition"]

        expect(disposition).toContain("attachment")
        expect(disposition).toContain("0x676179.mobileconfig")
      }).pipe(Effect.provide(E2ETestLayer)))

    it.live("allows guests to download guest profiles", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient

        const [, res] = yield* client["mobile-config"]["wifi-download"]({
          params: {
            ssid: "0x676179",
            encryption: "WPA2",
          },
          query: {
            enterpriseClientType: "PEAP",
            username: "guest",
            password: "1234",
            disableMACRandomization: false,
            includeEthernetProfile: false,
          },
          responseMode: "decoded-and-response",
          headers: {},
        })

        const disposition = res.headers["content-disposition"]

        expect(disposition).toContain("attachment")
        expect(disposition).toContain("0x676179.mobileconfig")
      }).pipe(Effect.provide(E2ETestLayer)))
  })
})
