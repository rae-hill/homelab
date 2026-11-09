/**
 * Error chain description utilities for the tailor pipeline.
 *
 * Renders nested error causes into a single human-readable string for logging
 * and error messages.
 */

/**
 * Walk nested `.error` and `.cause` properties (and Error instances), rendering each
 * level as `TagOrClassName: message` joined with " <- ".
 *
 * - Prefer `_tag` for Effect Data.TaggedError instances
 * - Fall back to constructor.name, else typeof
 * - Cap each level at ~500 chars, total at ~2000 chars
 * - Append "…" when truncated
 * - Never throws on weird input (defensive try/catch around JSON)
 */
export const describeErrorChain = (error: unknown, maxDepth = 6): string => {
  // Handle null/undefined at the top level
  if (error === null) {
    return "null"
  }
  if (error === undefined) {
    return "undefined"
  }

  const parts: Array<string> = []
  let current = error
  let depth = 0
  let totalLength = 0

  while (current !== null && current !== undefined && depth < maxDepth && totalLength < 2000) {
    let levelName: string
    let message: string

    // Extract level name
    if (
      typeof current === "object" &&
      current !== null &&
      "_tag" in current &&
      typeof (current as any)._tag === "string"
    ) {
      levelName = (current as any)._tag
    } else if (current instanceof Error) {
      levelName = current.constructor.name
    } else if (typeof current === "object" && current !== null && "constructor" in current) {
      levelName = (current as any).constructor.name || "Object"
    } else {
      levelName = typeof current
    }

    // Extract message
    if (current instanceof Error && current.message) {
      message = current.message
    } else if (
      typeof current === "object" &&
      current !== null &&
      "message" in current &&
      typeof (current as any).message === "string"
    ) {
      message = (current as any).message
    } else {
      // Try to stringify
      try {
        const str = String(current)
        if (str !== "[object Object]") {
          message = str
        } else {
          const json = JSON.stringify(current, null, 0)
          message = json !== undefined ? json : String(current)
        }
      } catch {
        message = String(current)
      }
    }

    // Cap level at ~500 chars
    if (message.length > 500) {
      message = message.slice(0, 500) + "…"
    }

    const levelStr = `${levelName}: ${message}`
    parts.push(levelStr)
    totalLength += levelStr.length

    // Walk to next level
    depth++
    if (
      typeof current === "object" &&
      current !== null &&
      depth < maxDepth &&
      totalLength < 2000
    ) {
      if ("error" in current && (current as any).error !== null && (current as any).error !== undefined) {
        current = (current as any).error
      } else if (
        "cause" in current &&
        (current as any).cause !== null &&
        (current as any).cause !== undefined
      ) {
        current = (current as any).cause
      } else {
        break
      }
    } else {
      break
    }
  }

  const result = parts.join(" <- ")
  return totalLength >= 2000 ? result + "…" : result
}
