import { Duration, Effect, FileSystem, Layer, Option, Redacted, Schema } from "effect"
import { HttpClient, type HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Config, Services } from "homelab-services"
import { describeErrorChain } from "./tailor/errors.js"

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

// Helper to map errors to OpenRouterError. Avoids double-wrapping if the error
// is already an OpenRouterError (e.g. from an inner catch that was re-raised).
const mapError = (error: unknown): Services.OpenRouterClientService.OpenRouterError => {
  if (error instanceof Services.OpenRouterClientService.OpenRouterError) {
    return error
  }
  return new Services.OpenRouterClientService.OpenRouterError({
    message: error instanceof Error ? error.message : String(error),
    error,
  })
}

// Detect Effect's TimeoutError (tagged with _tag "TimeoutError"). Used to give
// timeout failures a dedicated message rather than the generic chain render.
const isTimeoutError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  (error as any)._tag === "TimeoutError"

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
      yield* Effect.logDebug("OpenRouter request starting", {
        model: req.model,
        messagesCount: req.messages.length,
        maxTokens: req.maxTokens,
        totalContentChars: req.messages.reduce((sum, m) => sum + m.content.length, 0),
      })

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

      // Execute with error recovery for non-2xx responses wrapped by filterStatusOk
      const response = yield* this.httpClient.execute(httpRequest).pipe(
        Effect.catch((executeErr) => {
          // filterStatusOk wraps non-2xx as HttpClientError with StatusCodeError reason
          // Extract response body for better error messages
          if (
            typeof executeErr === "object" &&
            executeErr !== null &&
            "_tag" in executeErr &&
            (executeErr as any)._tag === "HttpClientError"
          ) {
            const httpErr = executeErr as HttpClientError.HttpClientError
            const reason = httpErr.reason
            if (reason._tag === "StatusCodeError" && reason.response) {
              // Read the response body for the real OpenRouter error text. The catch is
              // scoped to the body READ only — an unscoped trailing catch would also
              // intercept the deliberate OpenRouterError below and always replace the
              // excerpt with the "(body unreadable)" variant.
              const failedResponse = reason.response
              return Effect.flatMap(
                failedResponse.text.pipe(Effect.catch(() => Effect.succeed(null))),
                (bodyText) => {
                  const excerpt = bodyText === null
                    ? "(body unreadable)"
                    : bodyText.length > 2000
                    ? bodyText.slice(0, 2000) + "…"
                    : bodyText
                  return Effect.fail(
                    new Services.OpenRouterClientService.OpenRouterError({
                      message: `OpenRouter API returned status ${failedResponse.status}: ${excerpt}`,
                      error: httpErr,
                    }),
                  )
                },
              )
            }
          }
          return Effect.fail(mapError(executeErr))
        }),
      )

      // Safety net: check status code explicitly (should not happen with filterStatusOk, but defensive)
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

      const result = {
        content,
        finishReason,
        usage: {
          promptTokens: decoded.usage?.prompt_tokens ?? 0,
          completionTokens: decoded.usage?.completion_tokens ?? 0,
        },
      }

      yield* Effect.logInfo("OpenRouter request succeeded", {
        model: req.model,
        finishReason,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
      })

      return result
    }).pipe(
      Effect.timeout(req.timeout),
      Effect.catch((error) => {
        // Dedicated message for timeout failures
        if (isTimeoutError(error)) {
          const timeoutSec = Duration.toSeconds(req.timeout)
          return Effect.flatMap(
            Effect.logError(`OpenRouter request timed out after ${timeoutSec}s for model ${req.model}`),
            () =>
              Effect.fail(
                new Services.OpenRouterClientService.OpenRouterError({
                  message: `OpenRouter request timed out after ${timeoutSec}s for model ${req.model}`,
                  error,
                }),
              ),
          )
        }
        // Log all other failures with chain description
        return Effect.flatMap(
          Effect.logError(`OpenRouter request failed: ${describeErrorChain(error)}`),
          () => Effect.fail(mapError(error)),
        )
      }),
    )
  }
}
