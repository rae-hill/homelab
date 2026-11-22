# 02 — Typst Rendering: typst.ts, Template, Assets

Covers CL-T1 (assets + dependency) and CL-T4 (rendering/template services). All facts about the
compiler below were verified against the **vendored source at `repos/typst.ts` tag `v0.7.0`**
(commit `08a46ecfd`) and the published npm metadata — not web docs (which describe `await`-based
APIs that do not exist; see caveats). Read-only repo: never edit, never import from `repos/`.

## Vendored facts that shape the design (v0.7.0)

| Fact                                                                                                                                                                                                                                                                                                                                                         | Consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm package: **`@myriaddreamin/typst-ts-node-compiler@0.7.0`** (`packages/typst.node`) exports `NodeCompiler`. There is NO `@typst.ts/*` scope at this tag.                                                                                                                                                                                                  | `yarn add` this exact package into `homelab-services-node`; pin `0.7.0` to match the submodule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| napi-rs prebuilt platform packages (`@myriaddreamin/typst-ts-node-compiler-linux-x64-gnu` etc.) via `optionalDependencies`; no node-gyp, no postinstall.                                                                                                                                                                                                     | Works in the Nix sandbox like `sharp`'s `@img/*` — but needs the same rolldown-external + copy + patchelf treatment (doc 05).                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Package is **CJS-only**; the server workspace is ESM (`"type": "module"`).                                                                                                                                                                                                                                                                                   | `import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler"` should lex as a named re-export (same pattern as `@swc/core`) — **smoke-test once in CL-T4**; fallback: default-import + destructure.                                                                                                                                                                                                                                                                                                                                                      |
| **All compiler methods are SYNCHRONOUS.** `pdf(...)` returns a Node `Buffer` and **throws** on compile errors (message = diagnostics summary). The docs' `await $typst.pdf(...)` only works because awaiting a non-promise is a no-op.                                                                                                                       | Every call site must be `Effect.try`/`Effect.sync`-wrapped (owner rule: any function/constructor that may throw gets its own Effect). Rendering blocks the event loop ~100s of ms — acceptable at homelab single-user traffic; `worker_threads` is the documented escape hatch if that ever changes.                                                                                                                                                                                                                                                              |
| Non-throwing path: `compile(opts): NodeTypstCompileResult` with `hasError()`, `result`, `takeWarnings()`, `takeDiagnostics(): NodeError \| null` (`shortDiagnostics`, `compilationStatus`), plus `compiler.fetchDiagnostics(err)` for full locations. `pdf()` silently DROPS warnings.                                                                       | Use `compile()` → inspect diagnostics (log warnings) → `pdf(result.result!)`, so font-fallback warnings are visible in logs instead of lost.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Universe packages: `NodeCompiler.create` hardwires `HttpRegistry`; resolution order is `dirs::data_dir()/typst/packages/<ns>/<name>/<ver>` → `dirs::cache_dir()/...` → download from `https://packages.typst.org` (preview only). **No create() option controls this.** `dirs` honors `XDG_DATA_HOME`/`XDG_CACHE_HOME`/`HOME`; unset ⇒ NotFound diagnostics. | **AVOIDED ENTIRELY (implementation decision):** the template imports the vendored letterloom **by path** (`../vendor/letterloom-3.0.0/src/lib.typ`) — letterloom is self-contained (only relative imports of its own src files, verified). No registry, no XDG env, no network, identical behavior in devshell/tests/nix-store. The initial XDG_DATA_HOME approach was built and then REMOVED: a vitest run pointed XDG_DATA_HOME at the git-tracked assets dir and tools polluted it (`vitest/`, `mimeapps.list`) — the hazard class is gone with the mechanism. |
| Embedded fonts: New Computer Modern (NewCM10, 4 styles + math), Libertinus Serif, DejaVu Sans Mono, Foxit PDF core fonts. Missing fonts ⇒ warnings + fallback, compile still succeeds.                                                                                                                                                                       | Letterloom renders out of the box with NewCM; `fontArgs: [{ fontPaths }]` is the seam if the owner wants resume-matching fonts (README OQ2).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `evictCache(maxAge)` is **global** (all instances); docs warn to evict periodically to avoid a memory leak; in-repo precedent: `projects/rehype-typst` evicts `10` after each compile.                                                                                                                                                                       | Evict `10` after every render — traffic is a handful of letters/day.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `mapShadow(path, Buffer)` / `addSource(path, string)` inject in-memory files; `create({ workspace, fontArgs, inputs })`; per-compile `inputs` REPLACE ctor inputs.                                                                                                                                                                                           | Signature PNG + generated letter data ride as shadows; no workspace dir needed at runtime.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## A) Assets (CL-T1) — `packages/homelab-services-node/assets/typst/`

Everything committed to the repo (CL-D5):

```
assets/typst/
├── templates/
│   └── letter.typ                              # letterloom-based template (below)
├── images/
│   └── signature.PNG                           # copy of ~/git/cover-letters/images/signature.PNG (96 KB)
└── vendor/
    └── letterloom-3.0.0/                       # unpacked universe tarball (Unlicense — OQ1 resolved):
                                                # curl -sL https://packages.typst.org/preview/letterloom-3.0.0.tar.gz | tar xz
                                                # imported BY PATH from letter.typ — bump = replace the dir
```

Runtime env (doc 05 owns wiring): `TYPST_ASSETS_DIR=<assets root>` only — NO XDG_DATA_HOME
anywhere (the by-path letterloom import made the package registry irrelevant).
Devshell, e2e bootstrap, and both testing layers resolve the same dir; production gets the
package-installed `$out/lib/typst-assets`.

## B) `templates/letter.typ` — layout contract

Direct adaptation of `~/git/cover-letters/sailpoint/cover-letters-2026-sailpoint.typ`
(owner-confirmed layout reference), with the variable parts fed from the shadow-mapped
`letter.json` (CL-D10):

```typst
#import "../vendor/letterloom-3.0.0/src/lib.typ": *

#let data = json("letter.json")   // shadow-mapped at <assets>/templates/letter.json
                                  // { toName, subject, paragraphs: [string] }

#show: letterloom.with(
  from-name: "Rae Hill (she/her)",
  from-address: [
    engineer\@rae-hill.dev \
    (505) 290-3096 \
    2794 Barnstormer St. \
    Fort Collins, CO 80524
  ],
  to-name: data.toName,            // extracted company, fallback "Hiring Team"
  to-address: [],
  date: datetime.today().display("[day padding:zero] [month repr:long] [year repr:full]"),
  salutation: "Recruitment, HR, or other esteemed prospective colleague",
  subject: text(weight: "bold")[Regarding the #data.subject],
  closing: "Regards,",
  signatures: ((
    name: "Rae Hill",
    signature: image("/images/signature.PNG", width: 5cm),   // shadow-mapped
  ),),
  footer: ( footer-text: text(size: 0.75em)[Made with Typst], footer-type: "string" ),
)

#for p in data.paragraphs {
  #p          // string→content join is LITERAL text: model-produced #,*,@,$ are inert
  #parbreak()
}
```

Design notes:

- **Sender block hard-coded in the template** — matches the resume site's public contact info;
  changing it is a code change (versioned, intentional).
- **Generation boundary**: the LLM produces ONLY `subject` + `paragraphs` (§01 §B schema).
  Salutation, closing, signature, footer, date are template-owned — smaller generation surface,
  no injection path into letterloom arguments. `toName` comes from stage-1 `company` extraction,
  NOT from the generation model (untrusted-text containment: it flows through `json()` + string
  join like the paragraphs).
- The template stays a **real `.typ` file** so the owner can iterate on it with the actual typst
  CLI/preview locally (`typst watch templates/letter.typ` from the assets dir — the by-path
  letterloom import needs zero env setup); it is read
  via `FileSystem` at service construction, not pasted into a TS string.
- Compile-time date via `datetime.today()` — same as the SailPoint letter (no clock input needed).

## C) `DocumentRenderingServiceTypst` (CL-T4)

Pairs with the existing `DocumentRenderingServiceDocx` (naming + adapter-injection precedent:
`makeDocumentRenderingServiceDocx(htmlToDocx: HtmlToDocxLike)`).

```ts
// homelab-services/src/services/document-rendering-service-typst.ts
export const DocumentRenderingServiceTypstId =
  "homelab-api/services/rendering/DocumentRenderingServiceTypst"

export class DocumentRenderingServiceTypstError
  extends Data.TaggedError("DocumentRenderingServiceTypstError")<{
    readonly message: string // e.g. "typst compilation failed" + diagnostics summary
    readonly error: unknown // raw nested cause (D12 pattern)
  }>
{}

export interface TypstRenderRequest {
  readonly mainFileContent: string
  readonly shadows: Readonly<Record<string, Uint8Array>> // absolute shadow paths → bytes
}

export interface DocumentRenderingServiceTypstDef {
  readonly renderPdf: (
    req: TypstRenderRequest,
  ) => Effect.Effect<Uint8Array, DocumentRenderingServiceTypstError>
}
```

Impl — `layers/document-rendering-service-typst.ts`:

- `makeDocumentRenderingServiceTypst(compilerLike: TypstCompilerLike)` factory for tests, where
  `TypstCompilerLike` is the minimal structural interface over `NodeCompiler` (`compile`, `pdf`,
  `mapShadow`, `resetShadow`, `evictCache`) — mirrors `HtmlToDocxLike`.
- `DocumentRenderingServiceTypstLive = Layer.effect(Tag, ...)`: reads `Config.Env.typstAssetsDir`
  (`None` ⇒ fail at construction with a typed config error — feature dark, same posture as the
  OpenRouter key); creates the singleton compiler **inside its own Effect**
  (`Effect.try(() => NodeCompiler.create({}))` — the constructor can throw on missing native
  binding), retries nothing, caches the instance on the Impl.
- `renderPdf` — one named span, every throwing call individually wrapped:
  ```ts
  Effect.fn("DocumentRenderingServiceTypst.renderPdf")(function*(req) {
    yield* Effect.try(() => compiler.resetShadow())            // isolate concurrent renders' shadows
    yield* Effect.forEach(Object.entries(req.shadows), ([p, b]) =>
      Effect.try(() => compiler.mapShadow(p, Buffer.from(b))))
    const compiled = yield* Effect.try({
      try: () => compiler.compile({ mainFileContent: req.mainFileContent }),
      catch: (e) => new DocumentRenderingServiceTypstError({ message: "typst compile call failed", error: e }),
    })
    // diagnostics: warnings → Effect.logWarning (shortDiagnostics messages); errors → typed failure
    const doc = /* compiled.result after hasError()/takeDiagnostics() inspection, all in Effect.try */
    const pdf = yield* Effect.try(() => compiler.pdf(doc))
    yield* Effect.sync(() => compiler.evictCache(10))          // global-cache hygiene (docs warning)
    return new Uint8Array(pdf)                                  // Buffer → platform-neutral copy (docx precedent)
  })
  ```
- **Concurrency caveat**: `resetShadow`/`mapShadow` state is per-instance and methods serialize on
  the JS thread; two overlapping renders could interleave shadow maps. Guard with a
  `Semaphore.withPermits(1)` around the whole render (cheap correctness, low traffic).
- Errors surfaced with diagnostics text in `message` (the thrown value's `.message` already
  contains the formatted diagnostics; do NOT rely on the thrown class identity — UNVERIFIED
  whether it is `Error` or `NodeError` at the napi boundary).

## D) `CoverLetterTemplateService` (CL-T4)

Content assembly ("what") split from compilation ("how"):

```ts
// homelab-services/src/services/cover-letter-template-service.ts
export interface CoverLetterInput {
  readonly subject: string
  readonly paragraphs: ReadonlyArray<string>
  readonly company: string | null
}
export interface CoverLetterDocument { // consumed directly by renderPdf
  readonly mainFileContent: string
  readonly shadows: Readonly<Record<string, Uint8Array>>
}
export interface CoverLetterTemplateServiceDef {
  readonly buildLetter: (
    input: CoverLetterInput,
  ) => Effect.Effect<CoverLetterDocument, CoverLetterTemplateError>
}
```

Impl — `layers/cover-letter-template-service.ts` (`Layer.effect`, deps: `Config.Env` +
`FileSystem.FileSystem`):

- At construction: load `templates/letter.typ` and `images/signature.PNG` from `typstAssetsDir`
  via `FileSystem` (Effect-wrapped reads; missing files ⇒ typed failure at layer build = deploy
  catches it at boot, not at first request).
- `buildLetter`: `shadows = { "templates/letter.json": utf8(JSON.stringify({ toName: company ?? "Hiring
  Team", subject, paragraphs })), "/images/signature.PNG": signatureBytes }`;
  `mainFileContent` = the loaded template. `JSON.stringify` IS the escaping layer (CL-D10) —
  no hand-rolled Typst escaping anywhere.
- Pure, no LLM text touches Typst syntax; unit-testable without the compiler (assert JSON shadow
  content, round-trip parse, weird-character paragraphs `#{}$@*` survive literally).

## E) Tests

- **Stubbed** (always run): `makeDocumentRenderingServiceTypst(fakeCompiler)` — happy path,
  compile-error → typed failure with diagnostics in message, warning logging, `evictCache` called,
  semaphore serializes two concurrent `renderPdf` calls.
- **Live render** (gated on `TYPST_ASSETS_DIR` in env — same gating idiom as `CHROME_EXECUTABLE`):
  build a fixture letter via `CoverLetterTemplateService`, render, assert `%PDF` magic + non-trivial
  length; write artifact to `COVER_LETTER_SAMPLE_PATH` when set (docx e2e precedent). Runs in
  devshell/e2e; CI skips.
- **JSON Schema snapshot** for `CoverLetterGeneration` (§01 §B).
- Native-binding smoke (CL-T1 acceptance): a one-off `node -e` that `require`s the compiler and
  compiles `Hello, typst!` to PDF — also embedded in the Nix build as a fail-closed check (doc 05).

## Build integration (repo side; Nix closure in doc 05)

- `packages/homelab-services-node/package.json`: `"@myriaddreamin/typst-ts-node-compiler": "0.7.0"`
  (exact pin — prebuilt binaries are version-locked across the platform packages).
- `packages/homelab-server/rolldown.config.js`: extend externals —
  `external: ["sharp", /^@img\//, "@myriaddreamin/typst-ts-node-compiler", /^@myriaddreamin\//]`
  (native `.node` cannot be inlined; node resolves it from the copied `node_modules` at runtime,
  exactly the sharp pattern documented in `nix-config/modules/homelab/homelab-api/package.nix`).
- `yarn.lock` change ⇒ **`nix-hashes` skill** before any `nix build` (doc 05).

## Cross-references

- **Doc 01** — orchestrator that consumes `buildLetter` + `renderPdf`; wire schema; validation.
- **Doc 05** — package.nix closure copy + patchelf + smoke test, systemd env, devshell/e2e env.
- **`repos/typst.ts`** — `packages/typst.node/src/compiler/{mod.rs,node.rs}` (create/pdf/diagnostics),
  `packages/typst.node/__test__/index.spec.ts` (usage), `templates/compiler-node/src/main.ts`
  (ESM import example), `projects/rehype-typst/lib/compiler.cjs` (singleton + evict precedent).
