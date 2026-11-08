/**
 * Integration-style tests for OpenRouterClientServiceLive against a real local HTTP
 * server, using the SAME HttpClient shape production runs: global FetchHttpClient +
 * `HttpClient.filterStatusOk` (packages/homelab-server/src/main.ts).
 *
 * Why this matters: with filterStatusOk, non-2xx responses fail at `execute` with an
 * HttpClientError(StatusCodeError) BEFORE the client's in-gen status check ever sees
 * them — the OpenRouter error body (the actually-useful message, e.g. "model not
 * found" / "provider does not support json_schema") lives on the failure's response
 * and must be recovered into the OpenRouterError message. These tests pin that.
 *
 * NOTE: the shared vitest config runs tests CONCURRENTLY (sequence.concurrent: true),
 * so the fake server must be stateless: the scenario is selected by a marker in the
 * REQUEST BODY (each test sends a unique message content), never by mutable state.
 */
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Layer, Option } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Config, Services } from "homelab-services"
import { mkdtempSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll } from "vitest"
import { OpenRouterClientServiceLive } from "../src/layers/openrouter-client-service.js"

let server: Server
let baseUrl: URL

/** Stateless scenario router: the request body's message content selects the response. */
const respondByBody = (body: string): { status: number; body: string; hang?: boolean } => {
  if (body.includes("scenario-404")) {
    return {
      status: 404,
      body: JSON.stringify({ error: { message: "MARKER-404-BODY model not found", code: 404 } }),
    }
  }
  if (body.includes("scenario-huge")) {
    return { status: 400, body: `${"x".repeat(2500)}TAIL-MARKER` }
  }
  if (body.includes("scenario-hang")) {
    return { status: 200, body: "", hang: true }
  }
  if (body.includes("scenario-ok")) {
    return {
      status: 200,
      body: JSON.stringify({
        choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 11, completion_tokens: 22 },
      }),
    }
  }
  // default: 200 with a non-stop finish_reason
  return {
    status: 200,
    body: JSON.stringify({
      choices: [{ message: { content: "partial" }, finish_reason: "length" }],
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    }),
  }
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ""
    req.on("data", (chunk) => {
      raw += chunk
    })
    req.on("end", () => {
      const scenario = respondByBody(raw)
      if (scenario.hang) return // never respond — let the client timeout win
      res.writeHead(scenario.status, { "Content-Type": "application/json" })
      res.end(scenario.body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("no server address")
  baseUrl = new URL(`http://127.0.0.1:${address.port}/api/v1`)
})

afterAll(async () => {
  server?.closeAllConnections()
  await new Promise<void>((resolve) => server?.close(() => resolve()))
})

const keyFile = join(mkdtempSync(join(tmpdir(), "openrouter-client-test-")), "key")
writeFileSync(keyFile, "sk-or-v1-test-dummy")

/** Production-shaped client: FetchHttpClient + filterStatusOk (see main.ts). */
const FilterStatusOkClient = Layer.effect(
  HttpClient.HttpClient,
  Effect.map(HttpClient.HttpClient, HttpClient.filterStatusOk),
).pipe(Layer.provide(FetchHttpClient.layer))

const makeClientLayer = (apiKeyFile?: string | null) =>
  OpenRouterClientServiceLive.pipe(
    Layer.provide(
      Layer.succeed(Config.Env.Env, {
        openRouterApiKeyFile: apiKeyFile === null ? Option.none() : Option.some(apiKeyFile ?? keyFile),
        openRouterModel: "test-model",
        openRouterCleanupModel: "test-cleanup-model",
        openRouterBaseUrl: baseUrl,
      } as any),
    ),
    Layer.provide(NodeFileSystem.layer),
    Layer.provide(FilterStatusOkClient),
  )

const chat = (scenario: string, timeout: Duration.Duration = Duration.seconds(10)) =>
  Effect.gen(function*() {
    const client = yield* Services.OpenRouterClientService.OpenRouterClientService
    return yield* client.chat({
      model: "test-model",
      messages: [{ role: "user" as const, content: scenario }],
      responseFormat: {
        type: "json_schema" as const,
        json_schema: { name: "test", strict: true, schema: { type: "object" } },
      },
      maxTokens: 10,
      timeout,
    })
  })

const runChat = (scenario: string, apiKeyFile?: string | null) =>
  chat(scenario).pipe(Effect.provide(makeClientLayer(apiKeyFile)))

describe("OpenRouterClientServiceLive (real HTTP, filterStatusOk)", () => {
  it.effect("recovers the error body from a non-2xx response into the OpenRouterError message", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(runChat("scenario-404"))
      expect(error._tag).toBe("OpenRouterError")
      expect(error.message).toContain("status 404")
      // The regression: with an unscoped catch this excerpt was replaced by "(body unreadable)"
      expect(error.message).toContain("MARKER-404-BODY")
      expect(error.message).not.toContain("body unreadable")
    }))

  it.effect("truncates an oversized error body at 2000 chars", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(runChat("scenario-huge"))
      expect(error.message).toContain("status 400")
      expect(error.message).toContain("…")
      expect(error.message).not.toContain("TAIL-MARKER")
    }))

  it.live("produces a dedicated timeout message with model and duration", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(
        chat("scenario-hang", Duration.millis(500)).pipe(Effect.provide(makeClientLayer())),
      )
      expect(error._tag).toBe("OpenRouterError")
      expect(error.message).toContain("timed out")
      expect(error.message).toContain("test-model")
    }))

  it.effect("fails cleanly when no API key file is configured", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(runChat("scenario-ok", null))
      expect(error._tag).toBe("OpenRouterError")
      expect(error.message).toContain("not configured")
    }))

  it.effect("parses a successful chat completion (content, finishReason, usage)", () =>
    Effect.gen(function*() {
      const result = yield* runChat("scenario-ok")
      expect(result.content).toBe("{\"ok\":true}")
      expect(result.finishReason).toBe("stop")
      expect(result.usage).toEqual({ promptTokens: 11, completionTokens: 22 })
    }))

  it.effect("fails on a non-stop finish_reason with the reason in the message", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(runChat("scenario-default"))
      expect(error.message).toContain("length")
    }))
})
