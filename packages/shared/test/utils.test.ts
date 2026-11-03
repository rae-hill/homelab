import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { asMutable } from "../src/utils.js"

describe("asMutable", () => {
  it.effect("should return the same object as mutable", () =>
    Effect.gen(function*() {
      yield* Effect.succeed(true)
      const obj = { foo: "bar" } as const
      const result = asMutable(obj)

      expect(result).toBe(obj)
      expect(result).toEqual({ foo: "bar" })
    }))

  it.effect("should allow mutation of readonly object", () =>
    Effect.gen(function*() {
      yield* Effect.succeed(true)
      const obj = { foo: "bar" } as const
      const result = asMutable(obj)

      result.foo = "bar"

      expect(result.foo).toBe("bar")
    }))

  it.effect("should work with nested readonly objects", () =>
    Effect.gen(function*() {
      yield* Effect.succeed(true)
      const obj = { nested: { value: 42 } } as const
      const result = asMutable(obj)

      result.nested.value = 42

      expect(result.nested.value).toBe(42)
    }))
})
