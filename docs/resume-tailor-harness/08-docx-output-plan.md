# 08 — v3: DOCX output for resume printing (format-agnostic print pipeline)

Status: **planning** (2026-11-10). Owner-directed v3 phase. This doc is the authoritative plan for
tasks **T20–T24**. The v2 JsonPatch work (**T19**, doc 07 §H) is explicitly **on the backburner**
(owner, 2026-11-10) — it stays GATED/DEFERRED and is not part of this queue. Where this doc
touches artifacts doc 03/07 describe (the print endpoint, `PdfPrintService`), this doc wins.

## Purpose

Add an `outputFormat=pdf|docx` query param to `POST /resume/print`:

- **pdf** (default) — the existing flow, unchanged: puppeteer/headless chrome renders the resume
  SPA and returns `page.pdf()` bytes.
- **docx** (new) — puppeteer still loads the SPA so all JavaScript and stylesheets execute (the
  full resume DOM must exist), then the **full rendered HTML** is captured from the page and
  converted with `@turbodocx/html-to-docx`; the DOCX bytes come back over the same endpoint.

Motivation (owner): PDF resume parsers frequently mangle the layout/content; DOCX is expected to
parse better (ATS tools, LLM-based reviewers). Because that is a hypothesis, the plan gates the
frontend polish behind an **owner fidelity review** of a real sample DOCX (T22 gate).

The service layer becomes format-agnostic: `PdfPrintService` → `ResumePrintingService` with a
format parameter, and HTML→document conversion lives behind a new opaque
`DocumentRenderingServiceDocx` service (def in `homelab-services`, live impl in
`homelab-services-node`, per house pattern).

## Owner directives (2026-11-10) — the requirement list

- **N1** Query param on the resume print endpoint: `outputFormat=pdf|docx`.
- **N2** Default `pdf` keeps the existing puppeteer→PDF flow exactly as-is.
- **N3** For DOCX, puppeteer must execute the JS + stylesheets to load the full resume SPA; the
  full HTML is then plugged into `@turbodocx/html-to-docx`.
- **N4** Rename `pdf-print-service.ts` → `resume-printing-service.ts` (format-agnostic); add a
  format parameter (`pdf | docx`) to `printResume`.
- **N5** New service file `document-rendering-service-docx.ts` with method
  `formatHtml(html: string): Effect.Effect<Uint8Array, DocumentRenderingServiceError>`, "formatted
  in the usual way" (tag + def + `Effect.fn` accessor in `homelab-services`; live layer in
  `homelab-services-node`).
- **N6** The node impl wraps the async `HtmlToDocx`; **some options pass through as method
  parameters**; `homelab-services` defines its **own** options type so it is not tied to the
  library's implementation details.
- **N7** The DOCX `Buffer` is encoded as `Uint8Array` so `homelab-services` stays platform-neutral.
- **N8** Frontend: the settings-dialog **Print** button (currently `window.print()`) must do the
  same thing as the Download FAB, and both it and the FAB become Chakra **"Split Menus"**
  (button + attached menu trigger) with options **PDF / DOCX** that set the new query param. The
  typed Effect `HttpApiClient` on the resume page picks the new field up automatically once the
  `homelab-api` endpoint definitions change.
- **N9** Write a new planning doc (this one); JsonPatch (T19) goes on the backburner.
- **N10** Conserve tokens; delegate to cheaper subagents where possible.

## Clarifications & agent decisions (owner-reviewed 2026-11-10)

- **C1 — endpoint identity.** The owner's message said "resume/tailor endpoint", but the described
  flow (puppeteer PDF bytes back to the resume page) is unambiguously **`POST /resume/print`**
  (`packages/homelab-api/src/homelab/resume/print.ts`). The tailor endpoint stays JSON-only and is
  untouched.
- **C2 — new-service naming.** File `packages/homelab-services/src/services/document-rendering-service-docx.ts`;
  tag `DocumentRenderingServiceDocx`; id `"homelab-api/services/rendering/DocumentRenderingServiceDocx"`;
  error class `DocumentRenderingServiceError` (owner-named) lives in the same file; options type
  named `DocxDocumentOptions`. The `-docx` suffix on tag/file leaves room for sibling renderers
  (e.g. a future RTF/plain-text service) sharing the error type.
- **C3 — rename collateral.** `PdfPrintError` → `ResumePrintError` (format-specific name no longer
  fits); `PdfPrintServiceId` value changes to `"homelab-api/services/printing/ResumePrintingService"`;
  `Effect.fn` span names change (`"ResumePrintingService.printResume"`) — Tempo queries/dashboards
  keyed on the old span name (if any) need updating. Historical docs keep old names (not edited).
- **C4 — response content-type strategy.** One endpoint, two possible response MIME types. Chosen
  design (per effect 4.1.2 source research below): declare **two success schemas** at status 200 —
  PDF and DOCX `asUint8Array` members — each with a **magic-byte `Schema.check` filter** so the
  union encoder picks the right member (and thus the right `Content-Type`) per response, and the
  typed client accepts either content-type. Fallback if this misbehaves in practice: single
  `application/octet-stream` success (see OQ5).

## Verified current state (exploration + research, 2026-11-10)

### Repo facts

- **Endpoint** `packages/homelab-api/src/homelab/resume/print.ts`: `success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: "application/pdf" }))`;
  `query: Schemas.Resume.ResumePrintQuery` (`packages/homelab-services/src/schemas/resume.ts` —
  currently only `theme: OptionalWithDefault(PrintTheme, () => "light")`); auth via
  `Resume_Print` resource + `Middleware.AuthMiddleware`.
- **Service tag** `packages/homelab-services/src/services/pdf-print-service.ts` (41 lines):
  `PdfPrintServiceId`, `PdfPrintError extends Data.TaggedError` `{ message, error }`,
  `PdfPrintServiceDef.printResume(configBase64, theme)`, `Context.Service` tag, `Effect.fn`
  accessor — the exact house shape to mirror.
- **Live impl** `packages/homelab-services-node/src/layers/pdf-print-service.ts`:
  `PdfPrintServiceLive = Layer.effect(...).pipe(Layer.provide(PuppeteerServiceLive))`; flow =
  decode/validate config base64 → `PuppeteerService.withPage` (third-party-font tracking,
  confetti DNS block) → `evaluateOnNewDocument` localStorage seed → `goto` + wait
  `html[data-print-ready]` (font-stall fallback reload) → `page.pdf({ printBackground: true,
  preferCSSPageSize: true })` → 4-minute backstop timeout, `PuppeteerError`/`TimeoutError` mapped
  to `PdfPrintError`. The whole block up to print-ready is **format-independent** — the DOCX path
  branches only after it.
- **Wiring**: `layers/index.ts:21` + `services/index.ts:21` export barrels;
  `shell/printing.ts` `Aggregate = PdfPrintServiceLive`; `homelab-server/src/main.ts:44`
  `Layer.provide(Shell.Printing.Aggregate)`.
- **Handler** `packages/homelab-server/src/handlers/resume/print.ts`: `canCreate(identity,
  "Resume_Print", args)` → `Services.PdfPrintService.printResume(args.payload.config,
  args.query.theme)`; `Match.tag("PdfPrintError")` → `InternalServerError`.
- **Unit test** `packages/homelab-server/test/handlers/resume/print.test.ts`: stub layer via
  `Layer.succeed(Services.PdfPrintService.PdfPrintService, {...})`; asserts `Uint8Array` + `%PDF`
  magic bytes. No services-node test exists for the print layer (puppeteer-dependent).
- **e2e** `packages/homelab-e2e-tests/src/resume/print.test.ts`: typed-client calls; success
  asserts `Uint8Array` + `%PDF` magic `[0x25,0x50,0x44,0x46]`; **no explicit content-type
  assertion**; the live render test is gated on `CHROME_EXECUTABLE`.
- **Frontend** (`packages/resume`, React 18 + Chakra `^3.36.1` + Vite; workspace deps already
  include `homelab-api`, `homelab-services`, `shared`):
  - `src/components/download-fab.tsx` — purple round `IconButton` (fixed, bottom-left, above the
    settings FAB), gated on `useCanPrintResume()`; `requestResumePdf(exportBase64(), theme)` →
    `downloadPdf(pdf)` + toasts; spinner while busy.
  - `src/components/print-config-fab.tsx:944–955` — settings `Dialog.Footer`:
    `Reset | Cancel | Print`; **Print** = `handlePrint()` → `window.print()` (`:694–698`). The
    dialog itself is konami-unlocked (`editingEnabled`).
  - `src/state/homelab/print.ts` — `requestResumePdf(config, theme)` builds
    `HttpApiClient.make(Homelab.HomelabApi)` and calls `client.resume.print({ payload, query:
    { theme }, headers })`; `downloadPdf(bytes, filename_?)` hardcodes blob MIME
    `application/pdf` and a `resume-rae-hill-<date>-<hex>.pdf` filename. Re-exported from
    `src/state/homelab/index.ts:10`.
  - Existing Chakra snippet wrappers: only `src/components/chakra/tooltip.tsx` and `toaster.tsx`.

### Research fact sheet 1 — effect 4.1.2 HttpApi response content-types (vendored `repos/effect`, version matches yarn.lock exactly)

- `HttpApiSchema.asUint8Array({ contentType })` annotates the AST (`repos/effect/packages/effect/src/http-api/HttpApiSchema.ts:1416–1421`;
  default `application/octet-stream` `:1324–1329`). Encoding is resolved **statically per
  success-schema member** at builder construction (`HttpApiBuilder.ts:1434–1452`,
  `getResponseEncode :1495–1543`; Uint8Array case `:1529–1534` →
  `Response.uint8Array(bytes, { status, contentType })`).
- An endpoint **may declare multiple success schemas with different content-types at the same
  status** (`HttpApiEndpoint.ts:1510–1516`, `:1538–1578`; only duplicate content-types throw).
- Union encoding tests members **in order, first match wins** (`Schema.ts:4969–4971`). Two plain
  `Uint8Array` members are indistinguishable → member #1 would always win. Adding a Type-side
  **magic-byte `Schema.check`** to each member (`%PDF` = `0x25 0x50 0x44 0x46`; DOCX/ZIP =
  `0x50 0x4B 0x03 0x04`) makes encoding pick correctly while `Type` stays `Uint8Array` (handlers,
  tests, client bytes unchanged).
- Typed client dispatches on the **actual response content-type** among the declared alternatives
  (`HttpApiClient.ts:1146–1196`) and fails `Unsupported response content-type` if undeclared — so
  **both** MIME types must appear in `success` or the browser client rejects the DOCX response.
- `HttpApiSchema.WithHeaders` per-response header override exists (`HttpApiSchema.ts:1013–1067`,
  applied post-encode at `HttpApiBuilder.ts:1478–1489`) **but breaks the typed client's static
  content-type dispatch → rejected** (C4).

### Research fact sheet 2 — `@turbodocx/html-to-docx` (npm 1.23.3, ~2026-10-30; GitHub turbodocx/html-to-docx)

- **Default export**: `import HtmlToDocx from "@turbodocx/html-to-docx"`; signature
  `await HtmlToDocx(htmlString, headerHTMLString?, documentOptions?, footerHTMLString?)` →
  `Promise<Buffer>` (Node) / `Promise<Blob>` (browser). Dual ESM/UMD; Node 22 OK. (`Buffer extends
  Uint8Array`, so N7 is satisfied by copying into a plain `Uint8Array` — see T21.)
- Published 11 days before planning; repo gate `npmMinimalAgeGate: "5d"` is satisfied (re-check at
  install time).
- **documentOptions** (subset relevant to us): `orientation: "portrait"|"landscape"`;
  `pageSize {width,height}` (TWIPs, default 12240×15840 = US Letter);
  `margins {top,right,bottom,left,header,footer,gutter}` (TWIPs); `title`, `subject`, `creator`,
  `keywords[]`, `description`, `lastModifiedBy`, `revision`, `createdAt`, `modifiedAt`;
  `header/footer: boolean`, `headerType/footerType`, `pageNumber`, `skipFirstHeaderFooter`,
  `lineNumber(+Options)`; `font` (default "Times New Roman"), `fontSize` (**half-points**, default
  22 = 11pt), `complexScriptFontSize`; `table { row.cantSplit, borderOptions {size,stroke,color},
  addSpacingAfter }`; `heading { heading1..6 { font, fontSize, bold, spacing, keepLines, keepNext,
  outlineLevel } }`; `numbering.defaultOrderedListStyleType`; `decodeUnicode`, `lang`, `direction`;
  `preProcessing.skipHTMLMinify`; `imageProcessing { maxRetries, downloadTimeout, maxImageSize,
  svgHandling: "convert"|"native", ... }`.
- **CSS handling — the load-bearing constraint**: inline `style` attributes are fully parsed;
  `<style>` blocks are parsed but with **no CSS cascade resolution**; external
  `<link rel="stylesheet">` URLs are **NOT fetched**. Supported property subset ≈ color,
  background-color, font-family, font-size, font-weight, line-height, text-align, text-decoration,
  margin, padding, page-break-before/after, vertical-align, width, height, display, border
  (partial). → The Vite/Chakra build serves CSS via `<link>`/`<style>` classes, so a naive
  `page.content()` would produce a nearly unstyled DOCX. **The capture step must bake computed
  styles into inline `style` attributes in-page** (T22 design).
- Images: remote URLs fetched with retries; SVG embedded natively (Office 2019+) or converted with
  **optional `sharp`** (~34MB native dep — owner decided 2026-11-10: ADD it, OQ4 resolved; see
  T21 bundle externals + T24 nix runtime-closure packaging). `page-break-*` works on block
  elements; `list-style-type` supported.

### Research fact sheet 3 — Chakra v3 "Split Menu" (docs composition `button-with-split-menu`)

```tsx
import { Button, Group, IconButton, Menu, Portal } from "@chakra-ui/react"
import { LuChevronDown } from "react-icons/lu"

<Menu.Root positioning={{ placement: "bottom-end" }}>
  <Group attached>
    <Button variant="outline" size="sm">Save</Button>
    <Menu.Trigger asChild>
      <IconButton variant="outline" size="sm"><LuChevronDown /></IconButton>
    </Menu.Trigger>
  </Group>
  <Portal>
    <Menu.Positioner>
      <Menu.Content>
        <Menu.Item value="draft">Save as Draft</Menu.Item>
        {/* … */}
      </Menu.Content>
    </Menu.Positioner>
  </Portal>
</Menu.Root>
```

`Menu.*` and `Group` (with `attached`) ship in `@chakra-ui/react` 3.36 — no new snippet wrapper
needed; works with `IconButton` (FAB) as both main button and trigger.

## Design

### A) T20 — Rename `PdfPrintService` → `ResumePrintingService` (pure mechanical; no behavior change)

`git mv` + rename everywhere (keep `printResume` method name; no format param yet):

| From                                                                                | To                                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/homelab-services/src/services/pdf-print-service.ts`                       | `…/resume-printing-service.ts`                                                 |
| `PdfPrintServiceId` = `"…/printing/PdfPrintService"`                                | `ResumePrintingServiceId` = `"…/printing/ResumePrintingService"`               |
| `PdfPrintError`                                                                     | `ResumePrintError`                                                             |
| `PdfPrintServiceDef` / `PdfPrintService`                                            | `ResumePrintingServiceDef` / `ResumePrintingService`                           |
| `Effect.fn("PdfPrintService.printResume")`                                          | `Effect.fn("ResumePrintingService.printResume")`                               |
| `packages/homelab-services-node/src/layers/pdf-print-service.ts`                    | `…/resume-printing-service.ts`                                                 |
| `PdfPrintServiceLive` / `PdfPrintServiceImpl`                                       | `ResumePrintingServiceLive` / `ResumePrintingServiceImpl`                      |
| barrels: `services/index.ts:21`, `layers/index.ts:21` `export * as PdfPrintService` | `export * as ResumePrintingService`                                            |
| `shell/printing.ts` import/`Aggregate`                                              | `ResumePrintingServiceLive`                                                    |
| handler `Services.PdfPrintService.printResume` + `Match.tag("PdfPrintError")`       | `Services.ResumePrintingService.printResume` + `Match.tag("ResumePrintError")` |
| unit test stub (`print.test.ts`) references                                         | renamed                                                                        |

Also update the doc comments that say "PDF" where they now describe the general render (the tag's
docblock becomes format-agnostic; keep the PDF-flow specifics accurate). e2e references the
endpoint, not the service — expected untouched. `grep -rn "PdfPrint" packages/` must come back
empty at the end (docs/ excluded — historical).

Good candidate for delegation to a cheap model with this table as the checklist. Gate:
`yarn lint && yarn typecheck && yarn test` + `e2e src/resume`.

### B) T21 — `DocumentRenderingServiceDocx` service + dependency + bundle spike

1. **Dependencies**: `nix develop . --command bash -c 'yarn workspace homelab-services-node add @turbodocx/html-to-docx sharp'`
   (→ `^1.23.3`; confirm the age gate passes). `sharp` = the SVG→PNG converter the library uses
   when `svgHandling: "convert"` (OQ4 resolved). yarn.lock change ⇒ nix hashes refreshed in T24
   (nix-hashes skill).
2. **Tag file** `packages/homelab-services/src/services/document-rendering-service-docx.ts`
   (mirror `resume-printing-service.ts` shape exactly):
   - `DocumentRenderingServiceDocxId = "homelab-api/services/rendering/DocumentRenderingServiceDocx"`.
   - `export class DocumentRenderingServiceError extends Data.TaggedError("DocumentRenderingServiceError")<{ readonly message: string; readonly error: unknown }> {}`.
   - **Platform-neutral options** (N6) — `DocxDocumentOptions` plain interface (NOT a wire Schema;
     it never crosses HTTP). Initial subset, with units chosen to be library-agnostic:
     ```ts
     export interface DocxPageMargins {
       top: number
       right: number
       bottom: number
       left: number
     } // TWIPs (OOXML-native 1/20 pt)
     export interface DocxDocumentOptions {
       readonly orientation?: "portrait" | "landscape"
       readonly margins?: DocxPageMargins
       readonly font?: string // font family name
       readonly fontSizePt?: number // POINTS; adapter doubles to half-points
       readonly title?: string
       readonly subject?: string
       readonly creator?: string
       readonly pageNumber?: boolean
     }
     ```
     (The services-node adapter owns all library-specific units/defaults — that is the seam N6
     asks for. Extend the subset only when a consumer needs it.)
   - `DocumentRenderingServiceDocxDef.formatHtml(html: string, options?: DocxDocumentOptions):
     Effect.Effect<Uint8Array, DocumentRenderingServiceError>` + tag + `Effect.fn("DocumentRenderingServiceDocx.formatHtml")`
     accessor.
   - Barrel: `services/index.ts` `export * as DocumentRenderingServiceDocx from "./document-rendering-service-docx.js"`.
3. **Live impl** `packages/homelab-services-node/src/layers/document-rendering-service-docx.ts`:
   - House testability pattern (AGENTS/`makeXService` factories, cf. `tailor-quota-service.ts`):
     `makeDocumentRenderingServiceDocxService(htmlToDocx: HtmlToDocxLike)` +
     `DocumentRenderingServiceDocxLive = makeDocumentRenderingServiceDocxService(realHtmlToDocx)`.
     `HtmlToDocxLike` is a **locally declared minimal function type** (`(html: string, header: null,
     options: Record<string, unknown>, footer: null) => Promise<Buffer | Uint8Array>`) — the
     library's own types stay inside this file's import, never re-exported.
   - `formatHtml`: `Effect.tryPromise` around the call; map `DocxDocumentOptions` → library
     `documentOptions` (`fontSizePt * 2` → `fontSize`; margins/orientation/title/… pass through;
     omit undefined keys so library defaults apply; fixed adapter default
     `imageProcessing: { svgHandling: "convert" }` — sharp is bundled, OQ4 resolved); wrap
     failures in `DocumentRenderingServiceError` (`message: "html-to-docx conversion failed"`).
   - **Buffer → Uint8Array** (N7): `new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))`
     or `Uint8Array.prototype.slice.call`-style copy — the point is a platform-neutral copy, not a
     `Buffer` instance aliasing a pooled allocation.
   - Barrel: `layers/index.ts`.
4. **Unit test** `packages/homelab-services-node/test/document-rendering-service-docx.test.ts`
   (@effect/vitest, fake `HtmlToDocxLike`): options mapping (pt→half-points, undefined omitted),
   Buffer→Uint8Array copy semantics (`instanceof Buffer === false` on a platform-neutral check is
   not required, but byte equality + not-the-same-underlying-pool is), error wrapping.
5. **Bundle spike** (de-risks T22/T24): `yarn workspace homelab-server build`, then boot the
   bundle per the anti-loop protocol (devshell `CHROME_EXECUTABLE` not needed for boot). Confirm
   rolldown digests the dual ESM/UMD dep (no dynamic-require warnings). **sharp is native and
   must NOT be bundled**: add it to the rolldown externals in
   `packages/homelab-server/rolldown.config.js` (e.g. `external: ["sharp", /^@img\//]` beside the
   existing `stubOptionalNative` plugin) so the bundle keeps a runtime `require`/`import` of
   `sharp`; in the devshell, node resolves it upward from `dist/bundle` into the repo's
   `node_modules`. Check HOW `@turbodocx/html-to-docx` loads sharp (static import vs lazy
   `require` in try/catch) — either way it must stay external, and must NOT be stubbed like
   `bufferutil`/`utf-8-validate` (we want the load to SUCCEED). Spike assertion: a scratch
   conversion of HTML containing a tiny inline `<svg>` produces a DOCX with a PNG-embedded image
   (`svgHandling: "convert"` actually exercised). Record the outcome in progress.md.

### C) T22 — Wire v3 (`outputFormat` + dual content-type) + the DOCX capture path — **includes the owner fidelity gate**

**Schemas** (`packages/homelab-services/src/schemas/resume.ts`):

```ts
/** Output document format for POST /resume/print. */
export const PrintOutputFormat = Schema.Literals(["pdf", "docx"])
export type PrintOutputFormat = typeof PrintOutputFormat.Type

export const ResumePrintQuery = Schema.Struct({
  theme: OptionalWithDefault(PrintTheme, () => "light" as const),
  outputFormat: OptionalWithDefault(PrintOutputFormat, () => "pdf" as const),
})
```

**Endpoint** (`packages/homelab-api/src/homelab/resume/print.ts`) — per C4/fact sheet 1:

```ts
const PdfBytes = Schema.Uint8Array.pipe(
  Schema.check((bytes) =>
    bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ),
  HttpApiSchema.asUint8Array({ contentType: "application/pdf" }),
)
const DocxBytes = Schema.Uint8Array.pipe(
  Schema.check((bytes) =>
    bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ),
  HttpApiSchema.asUint8Array({
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }),
)
// success: [PdfBytes, DocxBytes]   (order = union first-match; both at 200)
```

(Exact combinator spelling — `Schema.check` vs `Schema.filter` — to be confirmed against effect
4.1.2 at implementation time; the mechanism is what matters: Type-side discrimination so the
ordered union picks the right member/content-type. `success` becomes an array; endpoint `Types`
and handler return type stay `Uint8Array`.)

**Service def** (`resume-printing-service.ts`): `printResume(configBase64: string, theme:
PrintTheme, format: PrintOutputFormat): Effect.Effect<Uint8Array, ResumePrintError>` — import the
schema type; update the docblock (PDF via `page.pdf`, DOCX via HTML capture +
`DocumentRenderingServiceDocx`).

**Handler**: pass `args.query.outputFormat` through (one-line change).

**Live impl** (`layers/resume-printing-service.ts`):

- Layer gains the injected renderer (N5): inside `Layer.effect`, `yield*
  Services.DocumentRenderingServiceDocx.DocumentRenderingServiceDocx`; provide it alongside
  puppeteer: `Layer.provide(Layer.merge(PuppeteerServiceLive, DocumentRenderingServiceDocxLive))`
  (mirrors how the layer already self-provides its deps; `shell/printing.ts` Aggregate unchanged).
- Everything through "print-ready observed" (config seed, goto, font-stall fallback) stays shared.
  Then branch on `format`:
  - `"pdf"` — existing `page.pdf(...)` block, untouched.
  - `"docx"` — **capture + convert**:
    1. `page.evaluate(DOCX_CAPTURE_SCRIPT)` (new module
       `packages/homelab-services-node/src/layers/docx-html-capture.ts` exporting the script as a
       **template string** — same no-DOM-lib-types pattern as the localStorage seed). The script:
       - Runs under **print media emulation** (`page.emulateMediaType("print")` before evaluate)
         so the site's existing `@media print` rules apply — FABs/dialog/tooltips compute to
         `display: none` exactly like they do for chrome's PDF printing.
       - Walks the DOM; **prunes** subtrees whose computed `display` is `none` (removes app chrome
         physically, since html-to-docx won't apply CSS cascade); also removes `<script>`,
         `<noscript>`, `<link>`, `<iframe>`, `<style>` nodes.
       - For every surviving element, reads `getComputedStyle` and writes the **supported-subset**
         whitelist (fact sheet 2: color, background-color, font-family, font-size, font-weight,
         line-height, text-align, text-decoration, margin/padding (4-side), border (width/style/
         color), width, height, vertical-align) into the element's inline `style` attribute.
         Computed values arrive in px — acceptable to the library; adjust at the fidelity gate if
         not.
       - Returns `"<!DOCTYPE html>" + document.documentElement.outerHTML`.
    2. `yield* Services.DocumentRenderingServiceDocx.formatHtml(html, options)` with a small
       initial options object (e.g. `{ orientation: "portrait", creator/title }` — final values
       tuned at the fidelity gate; keep margins default initially).
    3. Map `DocumentRenderingServiceError` → `ResumePrintError` (`Match.tag` alongside the
       existing PuppeteerError/TimeoutError mapping); the 4-minute backstop still bounds
       capture+conversion (both run inside the same `withPage` effect).
    4. Log parity with the pdf path: `[print] docx captured: N bytes html` / `[print] docx
       rendered: N bytes`.
- **Unit tests**: handler `print.test.ts` — stub asserts `format` pass-through (`"pdf"` default
  from query, `"docx"` explicit); schema test that `ResumePrintQuery` defaults `outputFormat`;
  if feasible at unit level, an encode-side check that DOCX-magic bytes select the docx
  content-type member (otherwise covered by the T24 raw-HTTP e2e assertion).

**GATE — owner fidelity review (before T23):** produce a real sample —
`RUN nothing special; e2e src/resume or a scratch script` with `CHROME_EXECUTABLE` set, save the
DOCX, owner opens it (Word/LibreOffice) **and runs it through the parser(s) that motivated this
feature**. Outcomes to settle at the gate: whitelist tweaks (px vs pt), SVG icon handling (OQ4),
margins/font options, whether print-media emulation prunes too much/little. Iterate the capture
script here — NOT after the frontend is built. Record findings in progress.md §Gotchas.

### D) T23 — Frontend: split menus + format-aware download

All in `packages/resume` (no test infra by design — D8; validate with `yarn workspace resume build` + typecheck):

1. **`src/state/homelab/print.ts`**:
   - `requestResumePdf` → `requestResumeDocument(config, theme, outputFormat: "pdf" | "docx")`;
     passes `query: { theme, outputFormat }`. (Typed client arg types update automatically from
     `homelab-api` — N8.)
   - `downloadPdf` → `downloadResumeDocument(bytes, format)`: MIME map
     `{ pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }`,
     filename `resume-rae-hill-<date>-<hex>.<format>` (same generator).
   - Update `src/state/homelab/index.ts` re-exports.
2. **Shared hook** `src/state/homelab/use-resume-download.ts` (or colocated in print.ts):
   `useResumeDownload()` → `{ busyFormat: "pdf" | "docx" | null, download(format) }` encapsulating
   the `Effect.runPromise(requestResumeDocument(exportBase64(), theme, format))` + toasts
   (format-aware copy: "PDF ready"/"DOCX ready", "Couldn't download PDF/DOCX") + busy state. Both
   consumers use it — single source of truth for the flow the FAB has today.
3. **Shared menu items** — small component (e.g. `src/components/format-menu.tsx`) rendering the
   two `Menu.Item`s (`PDF`, `DOCX (Word)`) wired to `download(format)`; keeps both split menus
   consistent.
4. **Download FAB** (`download-fab.tsx`): keep gating/tooltip/placement; replace the single
   `IconButton` with the split-menu composition (fact sheet 3) inside the fixed-position wrapper:
   `Menu.Root` > `Group attached` (fixed position, `zIndex="docked"`, `css={hidePrint}`, rounded —
   main `IconButton` `rounded="full"` purple download icon + `Menu.Trigger asChild` chevron
   `IconButton`) > `Portal` > `Menu.Positioner` > `Menu.Content` > `FormatMenuItems`. Main button
   click = `download("pdf")` (unchanged default UX); spinner while busy. `positioning={{
   placement: "top-end" }}` (menu opens above the FAB).
5. **Settings dialog Print button** (`print-config-fab.tsx:944–955`): replace the `Print` button +
   `handlePrint`/`window.print()` with the same split-menu pattern sized for the footer: teal
   `Button` main (label "Print", click → `download("pdf")`) + `Menu.Trigger asChild` chevron
   `IconButton`, `Group attached`, items PDF/DOCX. Gating when `!useCanPrintResume()`: **keep
   `window.print()` as the main-button fallback and hide the chevron/menu** (preserves today's
   behavior for konami-unlocked visitors without the `resume.printing` role) — OQ1.
6. Busy/disabled states mirror the FAB (`aria-disabled` while a render is in flight).

### E) T24 — e2e + Nix hashes + full-suite close-out

1. **e2e** (`packages/homelab-e2e-tests/src/resume/print.test.ts`):
   - Existing pdf tests unchanged (default `outputFormat`); confirm they still pass with the dual
     success schema (client content-type dispatch).
   - New docx case, gated on `CHROME_EXECUTABLE` like the live pdf render: typed client with
     `query: { outputFormat: "docx" }` → `Uint8Array` + `PK\x03\x04` magic.
   - New **raw-HTTP content-type assertions** (the gap the research found): fetch with auth
     header, no param → `content-type: application/pdf`; `outputFormat=docx` →
     `content-type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
     This is the regression net for the C4 union-encoding design.
2. **Nix** (nix-hashes skill; yarn.lock changed in T21): refresh `fetchYarnBerryDeps` hashes —
   `nix-config/modules/features/homelab-api/package.nix`, `homelab-ui/package.nix`, and the
   resume-site package (`nix build` targets per the skill/progress.md precedents). `git add` any
   new files **before** `nix eval/build`. Then `nix build .#homelab-api .#homelab-ui .#resume-site`.
   - **sharp runtime closure (owner-flagged):** the homelab-api derivation installs ONLY
     `dist/bundle` (`package.nix:57–69`) — no node_modules at runtime — and builds with
     `YARN_ENABLE_SCRIPTS=0` (fine: sharp ≥0.33 ships prebuilt platform binaries via
     `@img/sharp-<platform>` optionalDependencies, no install scripts needed; the platform
     package matches the build architecture automatically — linux-x64 on x86_64, linux-arm64 on
     aarch64). Extend the `installPhase` to copy sharp's runtime closure into
     `$out/lib/bundle/node_modules/` (node's upward resolution finds it beside `main.js`):
     `node_modules/sharp`, `node_modules/@img/*`, plus sharp's pure-JS runtime deps (derive the
     exact list from sharp's `package.json` dependencies at implementation time — the
     color/detect-libc/semver family). Derivation smoke check:
     `node -e "require('$out/lib/bundle/node_modules/sharp')"` (or a 1×1 PNG resize) in an
     install-phase/post-install step so a broken closure fails the build, not augustus.
3. **Full `e2e` suite LAST** (owner directive), then the standard gate:
   `nix develop . --command bash -c 'yarn typecheck && yarn test && yarn lint'`.

## Task breakdown & waves

```
T20 rename (mechanical, delegatable) ──▶ T21 docx service + dep + bundle spike
                                              │
                                              ▼
                    T22 wire v3 + capture path ──▶ [GATE: owner DOCX fidelity review]
                                              │
                                              ▼
                    T23 frontend split menus ──▶ T24 e2e + nix hashes + full suite
```

Strictly serial (each task builds on the previous one's files; the gate sits mid-chain on
purpose). One commit per task, `git commit --no-verify`, progress.md status-table + session-log
update per task (house rules). Fresh worktree: `yarn seed:test-secrets` first; everything through
`nix develop`.

Delegation guidance (N10): T20 → cheap model with the rename table as checklist; T21 →
medium/cheap (pattern-mirrors existing services + fact sheet 2); T22 capture script + T23 →
design-heavy, primary or `qwen3.7-plus`; T24 mechanical. Read-only research → `explore` agent.

## Test plan

- **T20**: full unit suite green (renamed stubs), `e2e src/resume` green (no behavior change).
- **T21**: new services-node unit test (options mapping, byte copy, error wrapping); bundle boots.
- **T22**: handler unit tests (format pass-through, default); query-schema default test; manual
  sample DOCX = **owner fidelity gate**.
- **T23**: `yarn workspace resume build` + typecheck; manual browser pass (both split menus,
  gating fallback, toasts, filenames/MIMEs).
- **T24**: e2e pdf (unchanged) + docx (gated) + raw content-type assertions; FULL e2e suite;
  `nix build` trio; full validation gate.

## Open questions (owner)

- **OQ1 — RESOLVED (owner 2026-11-10, "that sounds great"):** settings-dialog Print button keeps
  the `window.print()` fallback + hides the format menu when `!canPrint` (design D.5).
- **OQ2** Naming sanity-check: `ResumePrintingService`/`ResumePrintError` (C3),
  `DocumentRenderingServiceDocx`/`DocumentRenderingServiceError`/`DocxDocumentOptions` (C2).
- **OQ3** `DocxDocumentOptions` subset + units (points for font size, TWIPs for margins — TWIP is
  OOXML-native, not library-specific). Anything else needed at the wire-through layer?
- **OQ4 — RESOLVED (owner 2026-11-10): use `sharp`.** Add it as a real dependency; the docx
  adapter passes `imageProcessing.svgHandling: "convert"` so react-icons SVGs rasterize to PNG.
  Native-module consequences (owner flagged the nix packaging): rolldown must keep
  `sharp`/`@img/*` external, and the homelab-api nix derivation must ship sharp's runtime closure
  next to the bundle — both designed into T21/T24 below.
- **OQ5** If the dual-success magic-byte union misbehaves at implementation time: fall back to a
  single `application/octet-stream` success schema (frontend sets blob MIME client-side anyway;
  raw content-type e2e assertions relax accordingly). Decision recorded here before T22 lands.
- **OQ6** DOCX download filename convention: same `resume-rae-hill-<date>-<hex>` stem + `.docx`
  (assumed yes).
- **OQ7 — theme for DOCX renders (NEW, surfaced by the first fidelity sample):** the dark theme's
  light-on-dark computed colors inline into the DOCX, where page backgrounds don't exist — text
  can render near-invisible on Word's white page. Options: (a) honor the requested `theme`
  (current behavior), (b) frontend sends `theme=light` whenever `outputFormat=docx`, (c) server
  forces light for docx. Recommendation: **(b)** — one line in the download hook, keeps the wire
  honest. Owner to confirm at the fidelity gate.
- **Disposition (owner 2026-11-10):** OQ1 + OQ4 resolved as above; OQ2/OQ3/OQ6 accepted (no
  objection — "ready for implementation"); OQ5 remains an emergency fallback only.

## Future work (parked — NOT planned now)

- **`POST /resume/print-plain`** (owner idea, 2026-11-10): a separate endpoint that takes the
  resume DATA and formats a super-plain DOCX with templating options — bypassing browser HTML
  capture and its CSS-fidelity constraints entirely. Revisit after v3 ships and the fidelity-gate
  learnings are in.
- Owner has a further idea for the CSS-fidelity concern; the agreed path is to ship T22's
  computed-style capture first and evaluate real output at the gate (2026-11-10).

## Cross-references

- Doc 03 (print-adjacent endpoint conventions), doc 07 (v2 plan of record; T19 §H backburnered),
  `docs/remote-printing-feature/` (historical PDF-flow design; names now superseded per C3),
  progress.md (status table + gotchas + session log), `adding-endpoints` / `nix-hashes` /
  `effect-services` skills, AGENTS.md house rules.
- Research provenance: effect content-type mechanics from `repos/effect` @ 4.1.2 (source-cited
  above); turbodocx facts from npm/GitHub README+types (1.23.3); Chakra split-menu from the
  chakra-ui docs compositions source (`button-with-split-menu`).
