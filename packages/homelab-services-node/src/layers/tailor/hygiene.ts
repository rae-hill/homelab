import { Effect } from "effect"

/**
 * Input hygiene for listings before prompting.
 *
 * Strips:
 * - base64 blobs (data:...;base64,...)
 * - <script>...</script> bodies
 * - zero-width chars (\u200B-\u200F, \u2060, \uFEFF) — injection-obfuscation vectors
 * - collapses whitespace runs
 *
 * Truncates listings >20k chars from the middle (requirements front-load, EEO back-loads):
 * 60% front + 40% back + "[...truncated...]" marker.
 */

const BASE64_BLOB_REGEX = /data:[^;]+;base64,[A-Za-z0-9+/=]+/g
const SCRIPT_TAG_REGEX = /<script[^>]*>[\s\S]*?<\/script>/gi
const ZERO_WIDTH_CHARS_REGEX = /[\u200B-\u200F\u2060\uFEFF]/g
const WHITESPACE_RUNS_REGEX = /\s+/g

const MAX_LISTING_CHARS = 20_000
const TRUNCATION_MARKER = "\n[...truncated...]\n"
const FRONT_RATIO = 0.6
const BACK_RATIO = 0.4

/** Strip injection vectors and normalize whitespace. */
export const sanitize = (input: string): string => {
  return input
    .replace(BASE64_BLOB_REGEX, "")
    .replace(SCRIPT_TAG_REGEX, "")
    .replace(ZERO_WIDTH_CHARS_REGEX, "")
    .replace(WHITESPACE_RUNS_REGEX, " ")
    .trim()
}

/** Truncate from the middle if >20k chars. Returns {truncated, result}. */
export const truncate = (input: string): { truncated: boolean; result: string } => {
  if (input.length <= MAX_LISTING_CHARS) {
    return { truncated: false, result: input }
  }

  const frontChars = Math.floor(MAX_LISTING_CHARS * FRONT_RATIO)
  const backChars = Math.floor(MAX_LISTING_CHARS * BACK_RATIO)

  const front = input.slice(0, frontChars)
  const back = input.slice(input.length - backChars)

  return {
    truncated: true,
    result: front + TRUNCATION_MARKER + back,
  }
}

/** Full hygiene pipeline: sanitize + truncate. Logs when truncation fires. */
export const hygienize = (input: string): Effect.Effect<{ sanitized: string; truncated: boolean }> => {
  return Effect.sync(() => {
    const sanitized = sanitize(input)
    const { result, truncated } = truncate(sanitized)
    return { sanitized: result, truncated }
  })
}
