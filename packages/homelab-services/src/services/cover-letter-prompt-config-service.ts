import { Context, Effect } from "effect"
import type { ResumeContent } from "shared"
import type { ChatMessage, ResponseFormat } from "./openrouter-client-service.js"

export const CoverLetterPromptConfigServiceId = "homelab-api/services/cover-letter/CoverLetterPromptConfigService"

/** Everything the generation stage needs besides the (static) system prompt. */
export interface CoverLetterGenerationInput {
  /** Stage-1 cleaned listing (verbatim-preserved spans). */
  readonly cleanedListing: string
  /** Stage-1 extracted job title. */
  readonly jobTitle: string
  /** Stage-1 extracted company (null when not found). */
  readonly company: string | null
  /** The tailored resume content the letter must match. */
  readonly content: ResumeContent.ContentState
}

export interface CoverLetterPromptConfigServiceDef {
  /**
   * Prompt version string (e.g. "cl-v1-2026-11"). Bump on any prompt/exemplar change —
   * it is part of the cleanup-cache key lineage and the observability meta.
   */
  readonly version: string

  /** Model-facing output-schema version (e.g. "cl-v1"). */
  readonly schemaVersion: string

  /**
   * Build the generation-stage chat messages: static system prefix first (prompt caching),
   * then style exemplars, then content digest + nonce-delimited cleaned listing.
   */
  readonly buildGenerationMessages: (args: CoverLetterGenerationInput) => ReadonlyArray<ChatMessage>

  /**
   * Build the generation-stage response format for OpenRouter strict JSON schema output.
   * Emits JSON Schema for CoverLetterGeneration (no refinements — strict-mode safe).
   */
  readonly buildGenerationResponseFormat: () => ResponseFormat
}

export class CoverLetterPromptConfigService
  extends Context.Service<CoverLetterPromptConfigService, CoverLetterPromptConfigServiceDef>()(
    CoverLetterPromptConfigServiceId,
  )
{}

/** {@inheritDoc CoverLetterPromptConfigServiceDef.buildGenerationMessages} */
export const buildGenerationMessages = Effect.fn("CoverLetterPromptConfigService.buildGenerationMessages")(
  function*(
    ...params: Parameters<CoverLetterPromptConfigServiceDef["buildGenerationMessages"]>
  ): Effect.fn.Return<
    ReadonlyArray<ChatMessage>,
    never,
    CoverLetterPromptConfigService
  > {
    const svc = yield* CoverLetterPromptConfigService
    return svc.buildGenerationMessages(...params)
  },
)

/** {@inheritDoc CoverLetterPromptConfigServiceDef.buildGenerationResponseFormat} */
export const buildGenerationResponseFormat = Effect.fn("CoverLetterPromptConfigService.buildGenerationResponseFormat")(
  function*(): Effect.fn.Return<
    ResponseFormat,
    never,
    CoverLetterPromptConfigService
  > {
    const svc = yield* CoverLetterPromptConfigService
    return svc.buildGenerationResponseFormat()
  },
)
