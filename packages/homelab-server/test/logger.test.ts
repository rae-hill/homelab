import { Redacted } from "effect"
import { describe, expect, it } from "vitest"
import { structureLogMessage } from "../src/logger.js"

describe("logger", () => {
  describe("structureLogMessage Redacted behavior", () => {
    it("should serialize Redacted values as <redacted>", () => {
      const secretValue = Redacted.make("super-secret-password")
      const result = structureLogMessage(secretValue)
      expect(result).toBe("<redacted>")
    })
  })
})
