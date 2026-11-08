import { Context, Data, Effect } from "effect"
import type { Duration } from "effect"

export const OpenRouterClientServiceId = "homelab-api/services/openrouter/OpenRouterClientService"

/** Raised when the OpenRouter API call fails (network, auth, decode, timeout, bad finish_reason). */
export class OpenRouterError extends Data.TaggedError("OpenRouterError")<{
  readonly message: string
  readonly error: unknown
}> {}

/** A single chat message in the conversation. */
export interface ChatMessage {
  readonly role: "system" | "user" | "assistant"
  readonly content: string
}

/** The strict JSON schema response format for structured output. */
export interface ResponseFormat {
  readonly type: "json_schema"
  readonly json_schema: {
    readonly name: string
    readonly strict: boolean
    readonly schema: unknown
  }
}

/** OpenRouter API request. */
export interface OpenRouterRequest {
  readonly model: string
  readonly messages: ReadonlyArray<ChatMessage>
  readonly responseFormat: ResponseFormat
  readonly maxTokens: number
  readonly timeout: Duration.Duration
}

/** OpenRouter API response. */
export interface OpenRouterResponse {
  readonly content: string
  readonly finishReason: string
  readonly usage: {
    readonly promptTokens: number
    readonly completionTokens: number
  }
}

export interface OpenRouterClientServiceDef {
  /**
   * Make a chat completion call to OpenRouter with strict structured output.
   * The ONLY HTTP talker in the tailor pipeline — provider-agnostic boundary.
   */
  readonly chat: (req: OpenRouterRequest) => Effect.Effect<OpenRouterResponse, OpenRouterError>
}

export class OpenRouterClientService
  extends Context.Service<OpenRouterClientService, OpenRouterClientServiceDef>()(OpenRouterClientServiceId)
{}

/** {@inheritDoc OpenRouterClientServiceDef.chat} */
export const chat = Effect.fn("OpenRouterClientService.chat")(function*(
  ...params: Parameters<OpenRouterClientServiceDef["chat"]>
): Effect.fn.Return<OpenRouterResponse, OpenRouterError, OpenRouterClientService> {
  const svc = yield* OpenRouterClientService
  return yield* svc.chat(...params)
})
