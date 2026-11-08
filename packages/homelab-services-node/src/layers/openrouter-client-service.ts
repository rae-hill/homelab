import { Effect, FileSystem, Layer, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Config, Services } from "homelab-services"

// OpenRouter response schema (minimal, just what we need)
const OpenRouterResponseSchema = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.Struct({
        content: Schema.NullOr(Schema.String),
      }),
      finish_reason: Schema.NullOr(Schema.String),
    }),
  ),
  usage: Schema.optional(
    Schema.Struct({
      prompt_tokens: Schema.Number,
      completion_tokens: Schema.Number,
    }),
  ),
})

// Helper to map errors to OpenRouterError
const mapError = (error: unknown): Services.OpenRouterClientService.OpenRouterError =>
  new Services.OpenRouterClientService.OpenRouterError({
    message: error instanceof Error ? error.message : String(error),
    error,
  })

/**
 * Live implementation of the OpenRouter client service.
 *
 * Reads the API key from a file (Redacted for safety), makes HTTP POST requests to
 * OpenRouter's chat completions endpoint with strict JSON schema output, and handles
 * response validation + finish_reason branching.
 */
export const OpenRouterClientServiceLive = Layer.effect(
  Services.OpenRouterClientService.OpenRouterClientService,
  Effect.gen(function*() {
    const env = yield* Config.Env.Env
    const fs = yield* FileSystem.FileSystem
    const httpClient = yield* HttpClient.HttpClient

    // Read API key at construction time — fail fast if configured but missing/unreadable
    const apiKey: Option.Option<Redacted.Redacted> = yield* Option.match(
      env.openRouterApiKeyFile,
      {
        onNone: () => Effect.succeed(Option.none()),
        onSome: (path) =>
          fs.readFileString(path).pipe(
            Effect.map((content) => Option.some(Redacted.make(content.trim()))),
            Effect.orDie,
          ),
      },
    )

    return new OpenRouterClientServiceImpl(env, apiKey, httpClient)
  }),
)

class OpenRouterClientServiceImpl implements Services.OpenRouterClientService.OpenRouterClientServiceDef {
  constructor(
    private readonly env: typeof Config.Env.Env.Service,
    private readonly apiKey: Option.Option<Redacted.Redacted<string>>,
    private readonly httpClient: HttpClient.HttpClient,
  ) {}

  chat(req: Services.OpenRouterClientService.OpenRouterRequest) {
    return Effect.gen({ self: this }, function*() {
      // Fail fast if no API key configured
      if (Option.isNone(this.apiKey)) {
        return yield* Effect.fail(
          new Services.OpenRouterClientService.OpenRouterError({
            message: "OpenRouter not configured on this host",
            error: null,
          }),
        )
      }

      const apiKey = this.apiKey.value

      const baseUrl = this.env.openRouterBaseUrl
      const url = new URL("/chat/completions", baseUrl)

      const body = {
        model: req.model,
        messages: req.messages,
        response_format: req.responseFormat,
        max_tokens: req.maxTokens,
        provider: {
          require_parameters: true,
          data_collection: "deny",
        },
      }

      const requestWithBody = yield* HttpClientRequest.post(url).pipe(
        HttpClientRequest.bodyJson(body),
      )
      const httpRequest = requestWithBody.pipe(
        HttpClientRequest.setHeader("Authorization", `Bearer ${Redacted.value(apiKey)}`),
        HttpClientRequest.setHeader("HTTP-Referer", "https://homelab.local"),
        HttpClientRequest.setHeader("X-Title", "Homelab Resume Tailor"),
      )

      const response = yield* this.httpClient.execute(httpRequest)

      // Check status code explicitly
      if (response.status < 200 || response.status >= 300) {
        const text = yield* response.text
        return yield* Effect.fail(
          new Services.OpenRouterClientService.OpenRouterError({
            message: `OpenRouter API returned status ${response.status}: ${text}`,
            error: null,
          }),
        )
      }

      const decoded = yield* HttpClientResponse.schemaBodyJson(OpenRouterResponseSchema)(response).pipe(
        Effect.mapError(mapError),
      )

      // Branch on finish_reason — never infer success from 200
      const finishReason = decoded.choices[0]?.finish_reason
      if (finishReason !== "stop" && finishReason !== "end_turn") {
        return yield* Effect.fail(
          new Services.OpenRouterClientService.OpenRouterError({
            message: `OpenRouter finished with unexpected reason: ${finishReason}`,
            error: decoded,
          }),
        )
      }

      const content = decoded.choices[0]?.message.content
      if (!content) {
        return yield* Effect.fail(
          new Services.OpenRouterClientService.OpenRouterError({
            message: "OpenRouter response missing content",
            error: decoded,
          }),
        )
      }

      return {
        content,
        finishReason,
        usage: {
          promptTokens: decoded.usage?.prompt_tokens ?? 0,
          completionTokens: decoded.usage?.completion_tokens ?? 0,
        },
      }
    }).pipe(
      Effect.timeout(req.timeout),
      Effect.mapError(mapError),
    )
  }
}
