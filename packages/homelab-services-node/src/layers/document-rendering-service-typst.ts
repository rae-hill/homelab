import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler"
import { Effect, Layer, Semaphore } from "effect"
import { Config, Services, Utils } from "homelab-services"
import { Buffer } from "node:buffer"
import * as path from "node:path"

/**
 * `DocumentRenderingServiceTypst` — adapter over the typst.ts all-in-one Node compiler
 * (docs/cover-letter-generator/02 §C). Pairs with document-rendering-service-docx.ts:
 * platform-neutral contract in homelab-services, library specifics contained HERE.
 *
 * Vendored-source facts driving this design (repos/typst.ts @ v0.7.0):
 * - ALL compiler methods are SYNCHRONOUS and THROW on failure — every call site gets its
 *   own Effect.try (owner rule); rendering blocks the event loop briefly (single-user
 *   homelab traffic — worker_threads is the documented escape hatch).
 * - `compile()` exposes diagnostics (warnings + errors); `pdf()` drops warnings — so the
 *   flow is compile → inspect → pdf(doc) (never blind pdf()).
 * - Shadow files are keyed by ABSOLUTE paths (workspace-joined); template-relative
 *   references resolve against the workspace, hence `path.join(workspace, relative)`
 *   (empirically verified — relative shadow keys never match).
 * - `evictCache` is GLOBAL and the docs warn to evict periodically (memory leak) —
 *   evict(10) after every render (rehype-typst precedent).
 * - Universe packages WOULD resolve via HttpRegistry (dirs::data_dir → download), but the
 *   letter template imports the vendored letterloom BY PATH — no registry, no
 *   XDG_DATA_HOME, no network, identical in devshell/tests/nix-store (doc 02 §B).
 */

/** Minimal structural view of the compiler's NodeError (diagnostics carrier). */
export interface TypstNodeErrorLike {
  readonly shortDiagnostics: ReadonlyArray<{ readonly message?: string }>
}

/** Minimal structural view of `compile()`'s result (method syntax keeps napi types assignable). */
export interface TypstCompileResultLike {
  hasError(): boolean
  readonly result: unknown | null
  takeWarnings(): TypstNodeErrorLike | null
  takeDiagnostics(): TypstNodeErrorLike | null
}

/**
 * Minimal structural interface over `NodeCompiler` — declared with method syntax so the
 * real (Buffer-typed) napi class is assignable, and tests can inject fakes
 * (house pattern: `HtmlToDocxLike` in document-rendering-service-docx.ts).
 */
export interface TypstCompilerLike {
  resetShadow(): void
  mapShadow(path: string, content: Uint8Array): void
  compile(opts: { mainFilePath: string }): TypstCompileResultLike
  pdf(doc: unknown): Uint8Array
  evictCache(maxAge: number): void
}

export type TypstCompilerFactory = (workspace: string) => TypstCompilerLike

/** Suggested `max_age` for regular non-watch tools (typst.ts docs). */
const EVICT_MAX_AGE = 10

const formatDiagnostics = (error: TypstNodeErrorLike | null): string => {
  if (error === null) return "unknown error"
  const messages = error.shortDiagnostics.map((d) => d.message ?? "(no message)")
  return messages.length > 0 ? messages.join("; ") : "unknown error"
}

class DocumentRenderingServiceTypstImpl
  implements Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypstDef
{
  /** Lazily-created singleton (rehype/vite-plugin precedent); guarded by the semaphore. */
  private compiler: { readonly instance: TypstCompilerLike; readonly workspace: string } | undefined

  constructor(
    private readonly env: typeof Config.Env.Env.Service,
    private readonly factory: TypstCompilerFactory,
    private readonly semaphore: Semaphore.Semaphore,
  ) {}

  private acquireCompiler(): Effect.Effect<
    { readonly instance: TypstCompilerLike; readonly workspace: string },
    Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypstError
  > {
    return Effect.gen({ self: this }, function*() {
      if (this.compiler !== undefined) {
        return this.compiler
      }
      // Feature-dark posture (OpenRouter client precedent): a missing TYPST_ASSETS_DIR is a
      // typed CALL-TIME failure, never a layer-build failure that would keep the server down.
      const workspace = yield* Effect.fromOption(
        this.env.typstAssetsDir,
        () =>
          new Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypstError({
            message: "TYPST_ASSETS_DIR is not configured — cover-letter rendering is dark on this host",
            error: null,
          }),
      )
      // The constructor can throw (missing/incompatible native binding).
      const instance = yield* Effect.try({
        try: () => this.factory(workspace),
        catch: (error) =>
          new Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypstError({
            message: "typst NodeCompiler construction failed (native binding?)",
            error: Utils.errorToJson(error),
          }),
      })
      this.compiler = { instance, workspace }
      return this.compiler
    })
  }

  /** Named-span render body — runs under the semaphore permit. */
  private readonly renderPdfLocked = Effect.fn("DocumentRenderingServiceTypst.renderPdf")(
    { self: this },
    function*(
      this: DocumentRenderingServiceTypstImpl,
      req: Services.DocumentRenderingServiceTypst.TypstRenderRequest,
    ) {
      const { instance: compiler, workspace } = yield* this.acquireCompiler()
      const wrap =
        (message: string) =>
        (error: unknown): Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypstError =>
          new Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypstError({
            message,
            error: Utils.errorToJson(error),
          })

      yield* Effect.try({ try: () => compiler.resetShadow(), catch: wrap("typst shadow reset failed") })

      for (const [relativePath, bytes] of Object.entries(req.shadows)) {
        const shadowPath = path.join(workspace, relativePath)
        yield* Effect.try({
          try: () => compiler.mapShadow(shadowPath, Buffer.from(bytes)),
          catch: wrap(`typst mapShadow failed for ${relativePath}`),
        })
      }

      const mainFilePath = path.join(workspace, req.mainFilePath)
      const compiled = yield* Effect.try({
        try: () => compiler.compile({ mainFilePath }),
        catch: wrap("typst compile call failed"),
      })

      // Surface font-fallback etc. warnings that pdf() would silently drop. Effect.sync +
      // inner try/catch keeps the error channel `never` (these getters must not poison it).
      const warnings = yield* Effect.sync(() => {
        try {
          return compiled.takeWarnings()
        } catch {
          return null
        }
      })
      if (warnings !== null) {
        yield* Effect.logWarning("typst render warnings", {
          diagnostics: warnings.shortDiagnostics.map((d) => d.message ?? "(no message)"),
        })
      }

      const hasError = yield* Effect.sync(() => {
        try {
          return compiled.hasError()
        } catch {
          return true // an accessor that throws is itself a compile failure
        }
      })
      if (hasError) {
        const diagnostics = yield* Effect.sync(() => {
          try {
            return compiled.takeDiagnostics()
          } catch {
            return null
          }
        })
        return yield* Effect.fail(
          new Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypstError({
            message: `typst compilation failed: ${formatDiagnostics(diagnostics)}`,
            error: diagnostics === null ? null : Utils.errorToJson(diagnostics.shortDiagnostics),
          }),
        )
      }
      if (compiled.result === null) {
        return yield* Effect.fail(
          new Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypstError({
            message: "typst compilation produced no document",
            error: null,
          }),
        )
      }

      const pdf = yield* Effect.try({
        try: () => compiler.pdf(compiled.result),
        catch: wrap("typst pdf export failed"),
      })

      // Global-cache hygiene (typst.ts docs: evict periodically to avoid a memory leak).
      yield* Effect.try({
        try: () => compiler.evictCache(EVICT_MAX_AGE),
        catch: wrap("typst cache eviction failed"),
      }).pipe(Effect.ignore)

      // Buffer → platform-neutral copy (never alias — toNeutralBytes precedent).
      return new Uint8Array(pdf)
    },
  )

  renderPdf(
    req: Services.DocumentRenderingServiceTypst.TypstRenderRequest,
  ): Effect.Effect<Uint8Array, Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypstError> {
    // One permit: shadow-map state is per-instance; overlapping renders would interleave.
    return this.semaphore.withPermits(1)(this.renderPdfLocked(req))
  }
}

/**
 * Layer factory wrapping an injected compiler factory (fakeable in tests without the
 * native binding — makeDocumentRenderingServiceDocx pattern).
 */
export const makeDocumentRenderingServiceTypst = (factory: TypstCompilerFactory) =>
  Layer.effect(
    Services.DocumentRenderingServiceTypst.DocumentRenderingServiceTypst,
    Effect.gen(function*() {
      const env = yield* Config.Env.Env
      const semaphore = yield* Semaphore.make(1)
      return new DocumentRenderingServiceTypstImpl(env, factory, semaphore)
    }),
  )

/** Live layer backed by the real typst.ts NodeCompiler (workspace = TYPST_ASSETS_DIR). */
export const DocumentRenderingServiceTypstLive = makeDocumentRenderingServiceTypst((workspace) =>
  NodeCompiler.create({ workspace })
)
