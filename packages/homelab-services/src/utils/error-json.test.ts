import { Data, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { ErrorJson, errorToJson, parseErrorJson } from "./error-json.js"

class TestTaggedError extends Data.TaggedError("TestTaggedError")<{
  readonly message: string
}> {}

describe("errorToJson (Schema.Defect-based)", () => {
  it("serializes nested Error chains structurally (no string rendering)", () => {
    const json = errorToJson(new Error("outer", { cause: new Error("inner") }))
    expect(json).toEqual({
      name: "Error",
      message: "outer",
      cause: { name: "Error", message: "inner" },
    })
  })

  it("preserves tagged-error identity via name", () => {
    // Data.TaggedError sets prototype.name = the tag (verified: repos/effect internal/core.ts)
    const json = errorToJson(new TestTaggedError({ message: "boom" }))
    expect(json).toMatchObject({ name: "TestTaggedError", message: "boom" })
  })

  it("passes non-Error JSON values through the formatter", () => {
    expect(errorToJson("plain string")).toBe("plain string")
    expect(errorToJson({ detail: 42 })).toEqual({ detail: 42 })
    expect(errorToJson(null)).toBe(null)
  })

  it("marks circular references instead of throwing", () => {
    const loop = new Error("loop") as Error & { cause?: unknown }
    loop.cause = loop
    const json = errorToJson(loop) as { cause?: unknown }
    expect(json.cause).toBe("[Circular]")
  })

  it("encodes to schema-validated Json and round-trips through decode", () => {
    const json = errorToJson(new Error("outer", { cause: new TypeError("inner") }))
    expect(Schema.is(Schema.Json)(json)).toBe(true)

    const decoded = parseErrorJson(json) as Error
    expect(decoded).toBeInstanceOf(Error)
    expect(decoded.message).toBe("outer")
    expect((decoded.cause as Error).message).toBe("inner")
  })

  it("exposes the codec for schema composition", () => {
    // The codec itself is usable wherever a schema is expected (e.g. wire fields).
    expect(Schema.encodeSync(ErrorJson)(new Error("x"))).toEqual({ name: "Error", message: "x" })
  })
})
