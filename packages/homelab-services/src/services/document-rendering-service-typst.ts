import { Context, Data, Effect } from "effect"

export const DocumentRenderingServiceTypstId = "homelab-api/services/rendering/DocumentRenderingServiceTypst"

/** Raised when Typst compilation or PDF export fails (message carries the diagnostics summary). */
export class DocumentRenderingServiceTypstError extends Data.TaggedError("DocumentRenderingServiceTypstError")<{
  readonly message: string
  readonly error: unknown
}> {}

/**
 * Platform-neutral Typst render request.
 *
 * Deliberately homelab-services' OWN definition — not tied to typst.ts types. The
 * implementation adapter in `homelab-services-node` owns the `NodeCompiler` lifecycle,
 * absolute-path resolution against the workspace (the Typst assets dir), and the
 * sync/throwing API wrapping (doc 02 §C).
 */
export interface TypstRenderRequest {
  /** Workspace-relative main file (e.g. `templates/letter.typ`). */
  readonly mainFilePath: string
  /** Workspace-relative shadow files to map before compiling (e.g. the generated letter JSON). */
  readonly shadows: Readonly<Record<string, Uint8Array>>
}

export interface DocumentRenderingServiceTypstDef {
  /**
   * Compile a Typst document to PDF bytes.
   *
   * The compiler workspace is the Typst assets dir (`TYPST_ASSETS_DIR`), which also
   * contains the vendored universe packages resolved offline via `XDG_DATA_HOME`.
   * Returns platform-neutral `Uint8Array` bytes — never a Node `Buffer` instance.
   * Unconfigured assets dir or compile errors are typed failures (feature dark, not a crash).
   */
  readonly renderPdf: (req: TypstRenderRequest) => Effect.Effect<Uint8Array, DocumentRenderingServiceTypstError>
}

export class DocumentRenderingServiceTypst extends Context.Service<
  DocumentRenderingServiceTypst,
  DocumentRenderingServiceTypstDef
>()(DocumentRenderingServiceTypstId) {}

/** {@inheritDoc DocumentRenderingServiceTypstDef.renderPdf} */
export const renderPdf = Effect.fn("DocumentRenderingServiceTypst.renderPdf")(function*(
  ...params: Parameters<DocumentRenderingServiceTypstDef["renderPdf"]>
): Effect.fn.Return<Uint8Array, DocumentRenderingServiceTypstError, DocumentRenderingServiceTypst> {
  const svc = yield* DocumentRenderingServiceTypst
  return yield* svc.renderPdf(...params)
})
