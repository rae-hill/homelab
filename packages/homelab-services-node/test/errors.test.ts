import { describe, expect, it } from "@effect/vitest"
import { describeErrorChain } from "../src/layers/tailor/errors.js"

describe("describeErrorChain", () => {
  it("renders simple Error", () => {
    const err = new Error("something broke")
    const result = describeErrorChain(err)
    expect(result).toBe("Error: something broke")
  })

  it("renders TaggedError with _tag", () => {
    const err = { _tag: "CustomError", message: "custom message" }
    const result = describeErrorChain(err)
    expect(result).toBe("CustomError: custom message")
  })

  it("walks nested .error chain", () => {
    const inner = new Error("root cause")
    const middle = { _tag: "MiddleError", message: "middle layer", error: inner }
    const outer = { _tag: "OuterError", message: "outer layer", error: middle }
    const result = describeErrorChain(outer)
    expect(result).toBe("OuterError: outer layer <- MiddleError: middle layer <- Error: root cause")
  })

  it("walks nested .cause chain", () => {
    const inner = new Error("root cause")
    const middle = { _tag: "MiddleError", message: "middle layer", cause: inner }
    const outer = { _tag: "OuterError", message: "outer layer", cause: middle }
    const result = describeErrorChain(outer)
    expect(result).toBe("OuterError: outer layer <- MiddleError: middle layer <- Error: root cause")
  })

  it("prefers .error over .cause when both present", () => {
    const errorTarget = new Error("via error")
    const causeTarget = new Error("via cause")
    const err = { _tag: "TestError", message: "test", error: errorTarget, cause: causeTarget }
    const result = describeErrorChain(err)
    expect(result).toContain("via error")
    expect(result).not.toContain("via cause")
  })

  it("respects maxDepth limit", () => {
    let err: any = new Error("level 3")
    err = { _tag: "L2", message: "level 2", error: err }
    err = { _tag: "L1", message: "level 1", error: err }
    const result = describeErrorChain(err, 2)
    // Should stop at depth 2, not showing "level 3"
    expect(result).toBe("L1: level 1 <- L2: level 2")
    expect(result).not.toContain("level 3")
  })

  it("caps individual messages at 500 chars", () => {
    const longMessage = "x".repeat(600)
    const err = new Error(longMessage)
    const result = describeErrorChain(err)
    expect(result.length).toBeLessThan(600)
    expect(result).toContain("…")
  })

  it("caps total output at ~2000 chars", () => {
    let err: any = new Error("x".repeat(800))
    err = { _tag: "L2", message: "y".repeat(800), error: err }
    err = { _tag: "L1", message: "z".repeat(800), error: err }
    const result = describeErrorChain(err)
    expect(result.length).toBeLessThan(2500)
    expect(result).toContain("…")
  })

  it("handles null/undefined gracefully", () => {
    expect(describeErrorChain(null)).toBe("null")
    expect(describeErrorChain(undefined)).toBe("undefined")
  })

  it("handles non-Error objects", () => {
    const err = { code: 42, details: "something failed" }
    const result = describeErrorChain(err)
    expect(result).toContain("Object:")
    expect(result).toContain("code")
  })

  it("handles string errors", () => {
    const result = describeErrorChain("plain string error")
    expect(result).toBe("string: plain string error")
  })

  it("handles number errors", () => {
    const result = describeErrorChain(404)
    expect(result).toBe("number: 404")
  })

  it("handles circular references without throwing", () => {
    const err: any = { _tag: "CircularError", message: "circular" }
    err.self = err
    const result = describeErrorChain(err)
    expect(result).toContain("CircularError")
    expect(result).toContain("circular")
  })
})
