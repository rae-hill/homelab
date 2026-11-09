import { Context } from "effect"

export const PromptSanitizationServiceId = "homelab-api/services/tailor/PromptSanitizationService"

export interface TruncationOptions {
  readonly maxChars?: number
  readonly marker?: string
  readonly frontRatio?: number
  readonly backRatio?: number
}

/** Pure sync operations: cannot fail. */
export interface PromptSanitizationServiceDef {
  /**
   * Strip injection vectors and normalize whitespace:
   * - base64 blobs (data:...;base64,...)
   * - <script>...</script> bodies
   * - zero-width chars (injection-obfuscation vectors)
   * - collapses whitespace runs
   */
  readonly sanitize: (text: string) => string

  /**
   * Truncate from the middle if text exceeds maxChars.
   * Defaults: 20_000 chars, "\n[...truncated...]\n" marker, 0.6 front / 0.4 back ratios.
   */
  readonly truncate: (text: string, opts?: TruncationOptions) => {
    readonly truncated: boolean
    readonly result: string
  }

  /**
   * Full hygiene pipeline: sanitize + truncate. Defaults compose the current hard-coded constants.
   */
  readonly hygienize: (text: string, opts?: TruncationOptions) => {
    readonly sanitized: string
    readonly truncated: boolean
  }
}

export class PromptSanitizationService
  extends Context.Service<PromptSanitizationService, PromptSanitizationServiceDef>()(PromptSanitizationServiceId)
{}
