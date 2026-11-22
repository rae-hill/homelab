import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { Config, Services } from "homelab-services"
import * as path from "node:path"
import {
  makeDocumentRenderingServiceTypst,
  type TypstCompileResultLike,
  type TypstCompilerFactory,
  type TypstCompilerLike,
  type TypstNodeErrorLike,
} from "../src/layers/document-rendering-service-typst.js"

/** Records calls; every method is synchronous like the real napi binding. */
const makeFakeCompiler = (overrides: Partial<TypstCompilerLike> = {}) => {
  const state = {
    shadows: new Map<string, Uint8Array>(),
    shadowsAtCompile: [] as Array<Map<string, Uint8Array>>,
    compiledWith: [] as Array<string>,
    evicted: [] as Array<number>,
  }
  const okResult: TypstCompileResultLike = {
    hasError: () => false,
    result: { fake: "doc" },
    takeWarnings: () => null,
    takeDiagnostics: () => null,
  }
  const compiler: TypstCompilerLike = {
    resetShadow: () => state.shadows.clear(),
    mapShadow: (p, content) => void state.shadows.set(p, content),
    compile: (opts) => {
      state.compiledWith.push(opts.mainFilePath)
      state.shadowsAtCompile.push(new Map(state.shadows))
      return okResult
    },
    pdf: () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
    evictCache: (maxAge) => void state.evicted.push(maxAge),
    ...overrides,
  }
  return { state, compiler }
}

const envWith = (typstAssetsDir: Option.Option<string>) => Layer.succeed(Config.Env.Env, { typstAssetsDir } as any)

const renderWith = (
  factory: TypstCompilerFactory,
  assetsDir: Option.Option<string>,
  req: Services.DocumentRenderingServiceTypst.TypstRenderRequest = {
    mainFilePath: "templates/letter.typ",
    shadows: { "templates/letter.json": new TextEncoder().encode("{\"toName\":\"Acme\"}") },
  },
) =>
  Effect.gen(function*() {
    const service = yield* Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypst
    return yield* service.renderPdf(req)
  }).pipe(
    Effect.provide(
      makeDocumentRenderingServiceTypst(factory).pipe(Layer.provide(envWith(assetsDir))),
    ),
  )

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]
const ASSETS = "/fake/typst-assets"

describe("document rendering service (typst)", () => {
  it.effect("renders PDF bytes, maps shadows at ABSOLUTE workspace-joined paths, and evicts the global cache", () =>
    Effect.gen(function*() {
      const { compiler, state } = makeFakeCompiler()
      const pdf = yield* renderWith(() => compiler, Option.some(ASSETS))

      expect(Array.from(pdf.slice(0, 4))).toEqual(PDF_MAGIC)
      expect(pdf).toBeInstanceOf(Uint8Array)
      // Absolute-path shadow keys — the empirically-verified typst.ts contract (doc 02).
      const expectedShadowPath = path.join(ASSETS, "templates/letter.json")
      expect(state.shadowsAtCompile[0]!.has(expectedShadowPath)).toBe(true)
      expect(state.compiledWith).toEqual([path.join(ASSETS, "templates/letter.typ")])
      // Global-cache hygiene after every render (rehype-typst precedent).
      expect(state.evicted).toEqual([10])
    }))

  it.effect("fails with a typed error when TYPST_ASSETS_DIR is unset (feature dark, no crash)", () =>
    Effect.gen(function*() {
      const { compiler, state } = makeFakeCompiler()
      const error = yield* Effect.flip(renderWith(() => compiler, Option.none()))
      expect(error._tag).toBe("DocumentRenderingServiceTypstError")
      expect(error.message).toContain("TYPST_ASSETS_DIR is not configured")
      expect(state.compiledWith).toEqual([])
    }))

  it.effect("surfaces compile diagnostics in the typed failure", () =>
    Effect.gen(function*() {
      const diagnostics: TypstNodeErrorLike = {
        shortDiagnostics: [{ message: "error: font not found" }, { message: "error: bad import" }],
      }
      const errorResult: TypstCompileResultLike = {
        hasError: () => true,
        result: null,
        takeWarnings: () => null,
        takeDiagnostics: () => diagnostics,
      }
      const { compiler } = makeFakeCompiler({ compile: () => errorResult })
      const error = yield* Effect.flip(renderWith(() => compiler, Option.some(ASSETS)))
      expect(error._tag).toBe("DocumentRenderingServiceTypstError")
      expect(error.message).toContain("font not found")
      expect(error.message).toContain("bad import")
    }))

  it.effect("fails typed when compilation produced no document", () =>
    Effect.gen(function*() {
      const emptyResult: TypstCompileResultLike = {
        hasError: () => false,
        result: null,
        takeWarnings: () => null,
        takeDiagnostics: () => null,
      }
      const { compiler } = makeFakeCompiler({ compile: () => emptyResult })
      const error = yield* Effect.flip(renderWith(() => compiler, Option.some(ASSETS)))
      expect(error._tag).toBe("DocumentRenderingServiceTypstError")
      expect(error.message).toContain("no document")
    }))

  it.effect("wraps a throwing constructor (broken native binding) as a typed failure", () =>
    Effect.gen(function*() {
      const factory: TypstCompilerFactory = () => {
        throw new Error("Failed to load native binding")
      }
      const error = yield* Effect.flip(renderWith(factory, Option.some(ASSETS)))
      expect(error._tag).toBe("DocumentRenderingServiceTypstError")
      expect(error.message).toContain("construction failed")
    }))

  it.effect("each render starts from a clean shadow state (no cross-render leakage)", () =>
    Effect.gen(function*() {
      const { compiler, state } = makeFakeCompiler()
      yield* renderWith(() => compiler, Option.some(ASSETS), {
        mainFilePath: "templates/letter.typ",
        shadows: { "templates/letter.json": new TextEncoder().encode("{\"first\":true}") },
      })
      yield* renderWith(() => compiler, Option.some(ASSETS), {
        mainFilePath: "templates/letter.typ",
        shadows: { "templates/letter.json": new TextEncoder().encode("{\"second\":true}") },
      })
      // NOTE: two separate renderWith provides = two service instances sharing ONE fake
      // compiler — the resetShadow contract still guarantees the second compile saw only
      // the second render's shadow.
      const secondShadows = state.shadowsAtCompile[1]!
      expect(secondShadows.size).toBe(1)
      const content = new TextDecoder().decode(
        secondShadows.get(path.join(ASSETS, "templates/letter.json"))!,
      )
      expect(content).toContain("second")
      expect(content).not.toContain("first")
    }))

  it.effect("warnings do not fail the render (they are logged; pdf() would drop them)", () =>
    Effect.gen(function*() {
      const warningResult: TypstCompileResultLike = {
        hasError: () => false,
        result: { fake: "doc" },
        takeWarnings: () => ({ shortDiagnostics: [{ message: "font fallback used" }] }),
        takeDiagnostics: () => null,
      }
      const { compiler } = makeFakeCompiler({ compile: () => warningResult })
      const pdf = yield* renderWith(() => compiler, Option.some(ASSETS))
      expect(Array.from(pdf.slice(0, 4))).toEqual(PDF_MAGIC)
    }))

  it.effect("a throwing pdf() export becomes a typed failure", () =>
    Effect.gen(function*() {
      const { compiler } = makeFakeCompiler({
        pdf: () => {
          throw new Error("0: pdf export exploded")
        },
      })
      const error = yield* Effect.flip(renderWith(() => compiler, Option.some(ASSETS)))
      expect(error._tag).toBe("DocumentRenderingServiceTypstError")
      expect(error.message).toContain("pdf export failed")
    }))
})
