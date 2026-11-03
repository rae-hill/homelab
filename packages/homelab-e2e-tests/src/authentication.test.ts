import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { HttpClient, type HttpClientError, HttpClientRequest, type HttpClientResponse } from "effect/http"
import * as Crypto from "node:crypto"
import {
  BASE_URL,
  createToken,
  E2ETestLayer,
  getToken,
  makeTestDPoPWithoutJwk,
  makeTestDPoPWithWrongSignature,
  makeTestJwt,
  TEST_API_KEY,
} from "../test-utils/index.js"

interface AuthEndpointConfig {
  readonly displayName: string
  readonly url: URL
  readonly method: "GET" | "PUT"
}

const AUTH_ENDPOINTS: ReadonlyArray<AuthEndpointConfig> = [
  {
    displayName: "PUT /status/health",
    url: new URL(`${BASE_URL}/status/health`),
    method: "GET",
  },
  {
    displayName: "GET /mobile-config/certs",
    url: new URL(`${BASE_URL}/mobile-config/certs`),
    method: "GET",
  },
  {
    displayName: "PUT /mobile-config/wifi/:ssid/:encryption",
    url: new URL(`${BASE_URL}/mobile-config/wifi/test-ssid/WPA3`),
    method: "PUT",
  },
  {
    displayName: "GET /mobile-config/wifi/:ssid/:encryption/_download",
    url: new URL(`${BASE_URL}/mobile-config/wifi/test-ssid/WPA3/_download`),
    method: "GET",
  },
]

const makeRawRequest = (
  url: URL,
  method: "GET" | "PUT",
  headers: Record<string, string>,
): Effect.Effect<
  HttpClientResponse.HttpClientResponse,
  HttpClientError.HttpClientError,
  HttpClient.HttpClient
> =>
  Effect.gen(function*() {
    const httpClient = yield* HttpClient.HttpClient
    const req = method === "GET"
      ? HttpClientRequest.get(url.toString())
      : HttpClientRequest.put(url.toString())
    return yield* httpClient.execute(req.pipe(HttpClientRequest.setHeaders(headers)))
  })

const expectAuthError = (
  response: HttpClientResponse.HttpClientResponse,
  expectedReason: string,
): Effect.Effect<void, unknown> =>
  Effect.gen(function*() {
    expect(response.status).toBe(401)
    const body = yield* response.json

    expect((body as Record<string, unknown>)["reason"]).toBe(expectedReason)
  })

describe.for(AUTH_ENDPOINTS)("authentication: $displayName", (endpoint) => {
  it.live("rejects a malformed Authorization header value", () =>
    Effect.gen(function*() {
      const response = yield* makeRawRequest(endpoint.url, endpoint.method, {
        Authorization: "Bearer not-a-jwt",
      })
      yield* expectAuthError(response, "invalid-credential")
    }).pipe(Effect.provide(E2ETestLayer)))

  it.live("rejects a JWT missing the iss claim", () =>
    Effect.gen(function*() {
      const jwt = yield* makeTestJwt({ sub: "test-subject", email: "test@example.com" })

      const response = yield* makeRawRequest(endpoint.url, endpoint.method, {
        Authorization: `Bearer ${jwt}`,
      })
      yield* expectAuthError(response, "invalid-claims")
    }).pipe(Effect.provide(E2ETestLayer)))

  it.live("rejects a JWT whose issuer is not recognized", () =>
    Effect.gen(function*() {
      const jwt = yield* makeTestJwt({ iss: "https://unknown-issuer.example.com", sub: "test" })

      const response = yield* makeRawRequest(endpoint.url, endpoint.method, {
        Authorization: `Bearer ${jwt}`,
      })
      yield* expectAuthError(response, "unrecognized-issuer")
    }).pipe(Effect.provide(E2ETestLayer)))

  it.live("rejects a local-issuer token when no DPoP header is present", () =>
    Effect.gen(function*() {
      const { access_token, token_type } = yield* getToken(TEST_API_KEY)

      const response = yield* makeRawRequest(endpoint.url, endpoint.method, {
        Authorization: `${token_type} ${access_token}`,
      })

      yield* expectAuthError(response, "not-authenticated")
    }).pipe(Effect.provide(E2ETestLayer)))

  it.live("rejects a malformed DPoP header value", () =>
    Effect.gen(function*() {
      const { access_token } = yield* getToken(TEST_API_KEY)

      const response = yield* makeRawRequest(endpoint.url, endpoint.method, {
        Authorization: `DPoP ${access_token}`,
        DPoP: "not-a-jwt",
      })
      yield* expectAuthError(response, "invalid-credential")
    }).pipe(Effect.provide(E2ETestLayer)))

  it.live("rejects a DPoP proof whose protected header omits the jwk field", () =>
    Effect.gen(function*() {
      const { access_token } = yield* getToken(TEST_API_KEY)
      const dpop = yield* makeTestDPoPWithoutJwk(endpoint.url, endpoint.method)

      const response = yield* makeRawRequest(endpoint.url, endpoint.method, {
        Authorization: `DPoP ${access_token}`,
        DPoP: dpop,
      })
      yield* expectAuthError(response, "invalid-credential")
    }).pipe(Effect.provide(E2ETestLayer)))

  it.live("rejects a DPoP proof with the wrong htm claim", () =>
    Effect.gen(function*() {
      const { access_token, nonce } = yield* getToken(TEST_API_KEY)
      const wrongMethod = endpoint.method === "GET" ? ("POST" as const) : ("GET" as const)
      const ath = Crypto.createHash("sha256").update(access_token, "ascii").digest("base64url")
      const dpop = yield* createToken({ htu: endpoint.url, htm: wrongMethod, nonce, ath })

      const response = yield* makeRawRequest(endpoint.url, endpoint.method, {
        Authorization: `DPoP ${access_token}`,
        DPoP: dpop,
      })
      yield* expectAuthError(response, "invalid-credential")
    }).pipe(Effect.provide(E2ETestLayer)))

  it.live("rejects a DPoP proof with the wrong htu claim", () =>
    Effect.gen(function*() {
      const { access_token, nonce } = yield* getToken(TEST_API_KEY)
      const ath = Crypto.createHash("sha256").update(access_token, "ascii").digest("base64url")
      const wrongUrl = new URL("https://wrong-server.example.com/some/path")
      const dpop = yield* createToken({ htu: wrongUrl, htm: endpoint.method, nonce, ath })

      const response = yield* makeRawRequest(endpoint.url, endpoint.method, {
        Authorization: `DPoP ${access_token}`,
        DPoP: dpop,
      })
      yield* expectAuthError(response, "invalid-credential")
    }).pipe(Effect.provide(E2ETestLayer)))

  it.live("rejects a DPoP proof with an expired iat (beyond maxTokenAge)", () =>
    Effect.gen(function*() {
      const { access_token, nonce } = yield* getToken(TEST_API_KEY)
      const ath = Crypto.createHash("sha256").update(access_token, "ascii").digest("base64url")
      const expiredIat = Math.floor(Date.now() / 1000) - 7 * 60
      const dpop = yield* createToken({ htu: endpoint.url, htm: endpoint.method, nonce, ath, iat: expiredIat })

      const response = yield* makeRawRequest(endpoint.url, endpoint.method, {
        Authorization: `DPoP ${access_token}`,
        DPoP: dpop,
      })
      yield* expectAuthError(response, "signature-validation-failed")
    }).pipe(Effect.provide(E2ETestLayer)))

  it.live("rejects a DPoP proof where the signature does not match the embedded JWK", () =>
    Effect.gen(function*() {
      const { access_token } = yield* getToken(TEST_API_KEY)
      const dpop = yield* makeTestDPoPWithWrongSignature(endpoint.url, endpoint.method)

      const response = yield* makeRawRequest(endpoint.url, endpoint.method, {
        Authorization: `DPoP ${access_token}`,
        DPoP: dpop,
      })
      yield* expectAuthError(response, "signature-validation-failed")
    }).pipe(Effect.provide(E2ETestLayer)))

  it.live("rejects a DPoP proof that omits the required nonce", () =>
    Effect.gen(function*() {
      const { access_token } = yield* getToken(TEST_API_KEY)
      const ath = Crypto.createHash("sha256").update(access_token, "ascii").digest("base64url")
      const dpop = yield* createToken({ htu: endpoint.url, htm: endpoint.method, ath })

      const response = yield* makeRawRequest(endpoint.url, endpoint.method, {
        Authorization: `DPoP ${access_token}`,
        DPoP: dpop,
      })
      yield* expectAuthError(response, "invalid-credential")
    }).pipe(Effect.provide(E2ETestLayer)))

  it.live("rejects a DPoP proof with a nonce that has an invalid format (not two dot-separated parts)", () =>
    Effect.gen(function*() {
      const { access_token } = yield* getToken(TEST_API_KEY)
      const ath = Crypto.createHash("sha256").update(access_token, "ascii").digest("base64url")
      const dpop = yield* createToken({
        htu: endpoint.url,
        htm: endpoint.method,
        nonce: "invalid-nonce-format",
        ath,
      })

      const response = yield* makeRawRequest(endpoint.url, endpoint.method, {
        Authorization: `DPoP ${access_token}`,
        DPoP: dpop,
      })
      yield* expectAuthError(response, "signature-validation-failed")
    }).pipe(Effect.provide(E2ETestLayer)))

  it.live("rejects a DPoP proof with a nonce whose HMAC is tampered", () =>
    Effect.gen(function*() {
      const { access_token, nonce } = yield* getToken(TEST_API_KEY)
      const [timestamp] = nonce.split(".")
      const ath = Crypto.createHash("sha256").update(access_token, "ascii").digest("base64url")
      const tamperedNonce = `${timestamp}.tampered-hmac`
      const dpop = yield* createToken({ htu: endpoint.url, htm: endpoint.method, nonce: tamperedNonce, ath })

      const response = yield* makeRawRequest(endpoint.url, endpoint.method, {
        Authorization: `DPoP ${access_token}`,
        DPoP: dpop,
      })
      yield* expectAuthError(response, "signature-validation-failed")
    }).pipe(Effect.provide(E2ETestLayer)))

  it.live("rejects a DPoP proof that omits the ath claim when an access token is present", () =>
    Effect.gen(function*() {
      const { access_token, nonce } = yield* getToken(TEST_API_KEY)
      const dpop = yield* createToken({ htu: endpoint.url, htm: endpoint.method, nonce })

      const response = yield* makeRawRequest(endpoint.url, endpoint.method, {
        Authorization: `DPoP ${access_token}`,
        DPoP: dpop,
      })
      yield* expectAuthError(response, "invalid-credential")
    }).pipe(Effect.provide(E2ETestLayer)))

  it.live("rejects a DPoP proof whose ath claim does not match the access token", () =>
    Effect.gen(function*() {
      const { access_token, nonce } = yield* getToken(TEST_API_KEY)
      const wrongAth = Crypto.createHash("sha256").update("wrong-token-value", "ascii").digest("base64url")
      const dpop = yield* createToken({ htu: endpoint.url, htm: endpoint.method, nonce, ath: wrongAth })

      const response = yield* makeRawRequest(endpoint.url, endpoint.method, {
        Authorization: `DPoP ${access_token}`,
        DPoP: dpop,
      })
      yield* expectAuthError(response, "invalid-credential")
    }).pipe(Effect.provide(E2ETestLayer)))
})
