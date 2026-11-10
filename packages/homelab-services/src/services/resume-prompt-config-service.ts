import { Context, Effect } from "effect"
import type { ResumeContent } from "shared"
import type { ChatMessage, ResponseFormat } from "./openrouter-client-service.js"

export const ResumePromptConfigServiceId = "homelab-api/services/tailor/ResumePromptConfigService"

export interface ResumePromptConfigServiceDef {
  /**
   * Prompt version string — was "v1-2026-11" in wire-schema.ts, now a public service property.
   * Multiple version-keyed impls compose; version selection is deferred (OQ7).
   */
  readonly version: string

  /**
   * Model-facing output-schema version — was "v1" in wire-schema.ts.
   */
  readonly schemaVersion: string

  /**
   * Build stage 1 (cleanup) chat messages: system prompt + nonce-delimited listing.
   */
  readonly buildCleanupMessages: (args: {
    listing: string
  }) => ReadonlyArray<ChatMessage>

  /**
   * Build stage 1 response format for OpenRouter strict JSON schema output.
   * Emits JSON Schema for CleanupResponse (no pattern/minLength constraints — strict-mode safe).
   */
  readonly buildCleanupResponseFormat: () => ResponseFormat

  /**
   * Build stage 2 (tailor) chat messages: system prompt + nonce-delimited listing + content.
   */
  readonly buildTailorMessages: (args: {
    cleanedListing: string
    content: ResumeContent.ContentState
  }) => ReadonlyArray<ChatMessage>

  /**
   * Build stage 2 response format for OpenRouter strict JSON schema output.
   * Emits JSON Schema for TailorEdits (no pattern/minLength constraints — strict-mode safe).
   */
  readonly buildTailorResponseFormat: () => ResponseFormat
}

export class ResumePromptConfigService
  extends Context.Service<ResumePromptConfigService, ResumePromptConfigServiceDef>()(ResumePromptConfigServiceId)
{}

/** {@inheritDoc ResumePromptConfigServiceDef.buildCleanupMessages} */
export const buildCleanupMessages = Effect.fn("ResumePromptConfigService.buildCleanupMessages")(
  function*(
    ...params: Parameters<ResumePromptConfigServiceDef["buildCleanupMessages"]>
  ): Effect.fn.Return<
    ReadonlyArray<ChatMessage>,
    never,
    ResumePromptConfigService
  > {
    const svc = yield* ResumePromptConfigService
    return svc.buildCleanupMessages(...params)
  },
)

/** {@inheritDoc ResumePromptConfigServiceDef.buildCleanupResponseFormat} */
export const buildCleanupResponseFormat = Effect.fn("ResumePromptConfigService.buildCleanupResponseFormat")(
  function*(): Effect.fn.Return<
    ResponseFormat,
    never,
    ResumePromptConfigService
  > {
    const svc = yield* ResumePromptConfigService
    return svc.buildCleanupResponseFormat()
  },
)

/** {@inheritDoc ResumePromptConfigServiceDef.buildTailorMessages} */
export const buildTailorMessages = Effect.fn("ResumePromptConfigService.buildTailorMessages")(
  function*(
    ...params: Parameters<ResumePromptConfigServiceDef["buildTailorMessages"]>
  ): Effect.fn.Return<
    ReadonlyArray<ChatMessage>,
    never,
    ResumePromptConfigService
  > {
    const svc = yield* ResumePromptConfigService
    return svc.buildTailorMessages(...params)
  },
)

/** {@inheritDoc ResumePromptConfigServiceDef.buildTailorResponseFormat} */
export const buildTailorResponseFormat = Effect.fn("ResumePromptConfigService.buildTailorResponseFormat")(
  function*(): Effect.fn.Return<
    ResponseFormat,
    never,
    ResumePromptConfigService
  > {
    const svc = yield* ResumePromptConfigService
    return svc.buildTailorResponseFormat()
  },
)
