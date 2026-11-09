import { Layer } from "effect"
import { Services } from "homelab-services"

/**
 * Default truncation constants (E4 — now method arguments, not module-scoped constants).
 * These are the current values preserved as defaults for backward compatibility.
 */
const DEFAULT_MAX_LISTING_CHARS = 20_000
const DEFAULT_TRUNCATION_MARKER = "\n[...truncated...]\n"
const DEFAULT_FRONT_RATIO = 0.6
const DEFAULT_BACK_RATIO = 0.4

/**
 * Pure sync sanitization operations. Cannot fail.
 *
 * Strips:
 * - base64 blobs (data:...;base64,...)
 * - <script>...</script> bodies
 * - zero-width chars (\u200B-\u200F, \u2060, \uFEFF) — injection-obfuscation vectors
 * - collapses whitespace runs
 *
 * Truncates from the middle: 60% front + 40% back + marker (requirements front-load, EEO back-loads).
 */
export const makePromptSanitizationService = () =>
  Layer.sync(Services.PromptSanitizationService.PromptSanitizationService, () => {
    const sanitize = (text: string): string => {
      return text
        .replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/g, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/[\u200B-\u200F\u2060\uFEFF]/g, "")
        .replace(/\s+/g, " ")
        .trim()
    }

    const truncate = (
      text: string,
      opts?: {
        maxChars?: number
        marker?: string
        frontRatio?: number
        backRatio?: number
      },
    ): { truncated: boolean; result: string } => {
      const maxChars = opts?.maxChars ?? DEFAULT_MAX_LISTING_CHARS
      const marker = opts?.marker ?? DEFAULT_TRUNCATION_MARKER
      const frontRatio = opts?.frontRatio ?? DEFAULT_FRONT_RATIO
      const backRatio = opts?.backRatio ?? DEFAULT_BACK_RATIO

      if (text.length <= maxChars) {
        return { truncated: false, result: text }
      }

      const frontChars = Math.floor(maxChars * frontRatio)
      const backChars = Math.floor(maxChars * backRatio)

      const front = text.slice(0, frontChars)
      const back = text.slice(text.length - backChars)

      return {
        truncated: true,
        result: front + marker + back,
      }
    }

    return {
      sanitize,
      truncate,
      hygienize: (
        text: string,
        opts?: {
          maxChars?: number
          marker?: string
          frontRatio?: number
          backRatio?: number
        },
      ): { sanitized: string; truncated: boolean } => {
        const sanitized = sanitize(text)
        const { result, truncated } = truncate(sanitized, opts)
        return { sanitized: result, truncated }
      },
    }
  })

export const PromptSanitizationServiceLive = makePromptSanitizationService()
