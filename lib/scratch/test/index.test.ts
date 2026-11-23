import { describe, expect, it } from "vitest"
import { clamp, greet, slugify, sum } from "../src/index.js"

describe("greet", () => {
  it("greets the name", () => {
    expect(greet("world")).toBe("Hello, world!")
  })
})

describe("slugify", () => {
  it("slugifies simple text", () => {
    expect(slugify("Hello World")).toBe("hello-world")
  })

  it("strips diacritics", () => {
    expect(slugify("Crème Brûlée — Recipe!")).toBe("creme-brulee-recipe")
  })

  it("collapses non-alphanumeric runs and trims hyphens", () => {
    expect(slugify("  --foo@@bar--  ")).toBe("foo-bar")
  })

  it("returns empty string when nothing alphanumeric remains", () => {
    expect(slugify("!!!")).toBe("")
  })
})

describe("clamp", () => {
  it("clamps above max", () => {
    expect(clamp(15, 0, 10)).toBe(10)
  })

  it("clamps below min", () => {
    expect(clamp(-5, 0, 10)).toBe(0)
  })

  it("passes through in-range values", () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })
})

describe("sum", () => {
  it("sums values", () => {
    expect(sum([1, 2, 3])).toBe(6)
  })

  it("returns 0 for an empty list", () => {
    expect(sum([])).toBe(0)
  })
})
