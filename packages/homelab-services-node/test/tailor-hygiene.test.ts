import { describe, expect, it } from "@effect/vitest"
import { sanitize, truncate } from "../src/layers/tailor/hygiene.js"

describe("tailor hygiene", () => {
  describe("sanitize", () => {
    it("strips base64 blobs", () => {
      const input =
        "Hello data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg== world"
      const result = sanitize(input)
      expect(result).toBe("Hello world")
      expect(result).not.toContain("base64")
    })

    it("strips script tags", () => {
      const input = "Before<script>alert('xss')</script>After"
      const result = sanitize(input)
      expect(result).toBe("BeforeAfter")
      expect(result).not.toContain("<script>")
      expect(result).not.toContain("alert")
    })

    it("strips zero-width characters", () => {
      const input = "Hello\u200B\u200C\u200D\u200E\u200F\u2060\uFEFF world"
      const result = sanitize(input)
      expect(result).toBe("Hello world")
      expect(result.length).toBe(11)
    })

    it("collapses whitespace runs", () => {
      const input = "Hello    \n\n\t\t  world"
      const result = sanitize(input)
      expect(result).toBe("Hello world")
    })

    it("combines all sanitization steps", () => {
      const input = "Start\u200B<script>evil</script>data:image/gif;base64,R0lGODlh\u200C\n\n\nEnd"
      const result = sanitize(input)
      expect(result).toBe("Start End")
      expect(result).not.toContain("\u200B")
      expect(result).not.toContain("<script>")
      expect(result).not.toContain("base64")
    })
  })

  describe("truncate", () => {
    it("does not truncate strings under 20k chars", () => {
      const input = "x".repeat(10000)
      const { result, truncated } = truncate(input)
      expect(result).toBe(input)
      expect(result.length).toBe(10000)
      expect(truncated).toBe(false)
    })

    it("does not truncate strings at exactly 20k chars", () => {
      const input = "x".repeat(20000)
      const { result, truncated } = truncate(input)
      expect(result).toBe(input)
      expect(result.length).toBe(20000)
      expect(truncated).toBe(false)
    })

    it("truncates strings over 20k chars from the middle", () => {
      const input = "x".repeat(25000)
      const { result, truncated } = truncate(input)

      expect(truncated).toBe(true)
      // Should be 20k chars + truncation marker (with newlines)
      expect(result.length).toBeLessThan(input.length)
      expect(result.length).toBeLessThanOrEqual(20000 + "\n[...truncated...]\n".length)
      expect(result).toContain("[...truncated...]")

      // Front should be ~60% of 20k = 12k
      const truncationIndex = result.indexOf("\n[...truncated...]\n")
      expect(truncationIndex).toBe(12000)

      // Back should be ~40% of 20k = 8k
      const backStart = truncationIndex + "\n[...truncated...]\n".length
      const backLength = result.length - backStart
      expect(backLength).toBe(8000)
    })

    it("preserves front and back content when truncating", () => {
      const front = "FRONT".repeat(4000) // 20k chars
      const back = "BACK".repeat(3000) // 12k chars
      const input = front + "MIDDLE".repeat(1000) + back

      const { result, truncated } = truncate(input)

      expect(truncated).toBe(true)
      expect(result).toContain("FRONT")
      expect(result).toContain("BACK")
      expect(result).toContain("[...truncated...]")

      // Front portion should be at the start
      expect(result.startsWith("FRONT")).toBe(true)

      // Back portion should be at the end
      expect(result.endsWith("BACK")).toBe(true)
    })
  })
})
