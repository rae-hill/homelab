import { Effect, flow, Layer, Match, Result } from "effect"
import { Config, type Schemas, Services } from "homelab-services"
import { PrintConfig } from "shared"
import { DocumentRenderingServiceDocxLive } from "./document-rendering-service-docx.js"
import { DOCX_CAPTURE_SCRIPT } from "./docx-html-capture.js"
import {
  PuppeteerService,
  type PuppeteerServiceDef,
  PuppeteerServiceLive,
  type PuppeteerSession,
} from "./puppeteer-service.js"

/**
 * The resume's index.html pulls Victor Mono from fonts.googleapis.com (CSS) and
 * fonts.gstatic.com (woff2). Those are the only third-party hosts the print flow
 * treats as droppable: if their requests stall in flight, `document.fonts.ready`
 * never settles, so the app never sets `data-print-ready` — and `page.pdf()`
 * ALSO hangs while font loads are pending. The fallback below aborts them and
 * lets the site render with its `display=swap` fallback faces.
 */
const THIRD_PARTY_FONT_HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//

/**
 * The confetti vendor script (run.confettipage.com, injected by the resume's
 * prod-side-effects) is decorative, domain-bound — its `data-confetticode` is
 * issued for resume.rae-hill.dev, so on any other origin (e.g. the tailnet
 * print mirror resume.plato-splunk.media) the vendor errors/popups — and it is
 * one more third-party stall risk. Block it at the DNS level for print renders:
 * requests fail instantly (ERR_NAME_NOT_RESOLVED), no popups, no pending loads.
 */
const CONFETTI_DNS_BLOCK = "--host-resolver-rules=MAP run.confettipage.com ~NOTFOUND"

/**
 * Backstop bound on the whole render (launch → load → print-ready → pdf). Must
 * exceed the worst-case sum of the inner budgets (goto 60s + selector 30s,
 * doubled for the font-stall fallback reload, plus pdf/close protocol bounds)
 * so the HTTP handler ALWAYS resolves. The timeout interrupts the scoped
 * puppeteer session, whose finalizers still drain logs and close/kill chrome.
 */
const PRINT_BACKSTOP_TIMEOUT = "4 minutes"

/**
 * Initial DOCX conversion options — deliberately minimal; margins/font/etc.
 * are tuned from the owner fidelity review (doc 08 T22 gate).
 */
const DOCX_DOCUMENT_OPTIONS: Services.DocumentRenderingServiceDocx.DocxDocumentOptions = {
  orientation: "portrait",
}

/**
 * Puppeteer-backed document renderer for the resume site (PDF via chrome's
 * print renderer; DOCX via full-HTML capture + `DocumentRenderingServiceDocx`).
 *
 * The chrome executable comes from `CHROME_EXECUTABLE` (the nix derivation points it at
 * the store path of `google-chrome`); the site URL from `RESUME_SITE_URL` (augustus
 * serves the local build at https://resume.plato-splunk.media; the code default is the
 * public GitHub Pages origin). All browser plumbing — launch, page lifecycle, event
 * handlers, log queue, cleanup finalizers — lives in `PuppeteerService`; this layer is
 * the print-domain flow: seed the config, load, await print-ready (with the font-stall
 * fallback), render the document in the requested format, under a backstop timeout.
 */
export const ResumePrintingServiceLive = Layer.effect(
  Services.ResumePrintingService.ResumePrintingService,
  Effect.gen(function*() {
    const env = yield* Config.Env.Env
    const puppeteer = yield* PuppeteerService
    const docxRenderer = yield* Services.DocumentRenderingServiceDocx.DocumentRenderingServiceDocx

    return new ResumePrintingServiceImpl(env, puppeteer, docxRenderer)
  }),
).pipe(Layer.provide(Layer.merge(PuppeteerServiceLive, DocumentRenderingServiceDocxLive)))

class ResumePrintingServiceImpl implements Services.ResumePrintingService.ResumePrintingServiceDef {
  constructor(
    private readonly env: typeof Config.Env.Env.Service,
    private readonly puppeteer: PuppeteerServiceDef,
    private readonly docxRenderer: Services.DocumentRenderingServiceDocx.DocumentRenderingServiceDocxDef,
  ) {}

  printResume(configBase64: string, theme: Schemas.Resume.PrintTheme, format: Schemas.Resume.PrintOutputFormat) {
    return Effect.gen({ self: this }, function*() {
      // Closure capture for the inner page-runner generator (it has no `this`
      // binding of its own).
      const docxRenderer = this.docxRenderer
      const url = new URL(this.env.resumeSiteUrl)
      url.searchParams.set("theme", theme)

      // Decode the (edge-validated) base64 config into the JSON form the SPA
      // persists in localStorage; it is seeded into the page before load below.
      const configJson = yield* Effect.try({
        try: () => {
          const json = Buffer.from(configBase64, "base64").toString("utf-8")
          JSON.parse(json) // sanity check; the API edge already schema-validates the blob
          return json
        },
        catch: (error) =>
          new Services.ResumePrintingService.ResumePrintError({
            message: "Print config base64 did not decode to JSON",
            error,
          }),
      })

      const renderDocument = this.puppeteer.withPage(
        {
          trackRequestsMatching: THIRD_PARTY_FONT_HOSTS,
          extraLaunchArgs: [CONFETTI_DNS_BLOCK],
        },
        Effect.fn("puppeteer-run")(function*(session: PuppeteerSession) {
          const { page } = session
          const gotoOptions = { waitUntil: "networkidle2", timeout: 60_000 } as const
          const printReady = "html[data-print-ready]"
          let fontFallbackUsed = false

          const renderError = (error: unknown, afterFontFallback: boolean) =>
            new Services.ResumePrintingService.ResumePrintError({
              message: `Headless chrome failed to render the resume ${format.toUpperCase()} for ${url.origin}${
                afterFontFallback ? " (after font-stall fallback reload)" : ""
              }`,
              error,
            })

          // Seed the print config into the site's localStorage before any page script
          // runs — the SPA's PrintConfigProvider hydrates from localStorage on boot
          // (same path as a returning visitor). Script-text form with JSON.stringify'd
          // values: no DOM-lib types needed in this node package and no injection
          // surface. Runs on EVERY navigation, so the fallback reload re-seeds too.
          // NOT an `importPrintSettings` query param: real-world configs exceed
          // GitHub Pages' request-line limit → HTTP 414.
          yield* Effect.tryPromise({
            try() {
              return page.evaluateOnNewDocument(
                `try { window.localStorage.setItem(${JSON.stringify(PrintConfig.PRINT_CONFIG_LOCAL_STORAGE_KEY)}, ${
                  JSON.stringify(configJson)
                }) } catch {}`,
              )
            },
            catch: (error) => renderError(error, false),
          })

          yield* Effect.logInfo(`[print] config seeded; navigating to ${url.origin}`)

          const firstLoad = yield* Effect.tryPromise({
            async try() {
              await page.goto(url.toString(), gotoOptions)
              // The resume app sets `data-print-ready` on <html> once the hydrated
              // config and theme are applied to the redux store and the DOM re-renders.
              await page.waitForSelector(printReady, { timeout: 30_000 })
            },
            catch: (error) => error, // raw failure; the fallback check below decides
          }).pipe(Effect.result)

          if (Result.isSuccess(firstLoad)) {
            yield* Effect.logInfo("[print] page loaded; print-ready observed")
          }

          if (Result.isFailure(firstLoad)) {
            // Font-stall fallback (root-caused 2026-11-06): the page can reach
            // networkidle2 while stalled third-party font requests keep
            // `document.fonts.ready` pending forever. Detect the signature — tracked
            // font requests still in flight, or the FontFaceSet stuck at "loading" —
            // then reload once with those hosts aborted. Anything else rethrows.
            const pendingFontRequests = yield* session.pendingTrackedRequests
            // Probe the FontFaceSet without polluting the error channel: the
            // evaluate may fail (dead renderer etc.) and is purely advisory —
            // `Effect.catch` turns its `undefined` failure into a success so the
            // generator's E stays exactly the render/PuppeteerError union.
            const fontFaceSetStatus: unknown = yield* Effect.tryPromise({
              try() {
                return page.evaluate("document.fonts?.status")
              },
              catch: () => undefined,
            }).pipe(Effect.catch(() => Effect.succeed(undefined)))
            const fontsStalled = pendingFontRequests > 0 || fontFaceSetStatus === "loading"

            yield* Effect.logWarning(
              `[print] load/print-ready failed (${
                String(firstLoad.failure)
              }); pendingFontRequests=${pendingFontRequests} fontsStatus=${String(fontFaceSetStatus)}`,
            )

            if (!fontsStalled) {
              return yield* Effect.fail(renderError(firstLoad.failure, false))
            }

            fontFallbackUsed = true
            yield* Effect.logWarning("[print] font stall detected — aborting tracked hosts and reloading")
            yield* session.abortTrackedRequests

            yield* Effect.tryPromise({
              async try() {
                await page.goto(url.toString(), gotoOptions)
                await page.waitForSelector(printReady, { timeout: 30_000 })
              },
              catch: (error) => renderError(error, true),
            })
          }

          if (format === "docx") {
            // Apply the site's @media print rules before capture (same media
            // chrome's PDF printing uses), then run the in-page capture script:
            // prune print-hidden app chrome, replace inline SVG icons with
            // data-URL images, and bake computed styles into inline style
            // attributes (the converter applies no CSS cascade).
            yield* Effect.tryPromise({
              try() {
                return page.emulateMediaType("print")
              },
              catch: (error) => renderError(error, fontFallbackUsed),
            })

            const html = yield* Effect.tryPromise({
              try() {
                return page.evaluate(DOCX_CAPTURE_SCRIPT) as Promise<string>
              },
              catch: (error) => renderError(error, fontFallbackUsed),
            })

            yield* Effect.logInfo(`[print] docx html captured: ${html.length} chars`)

            const docxBytes = yield* docxRenderer.formatHtml(html, DOCX_DOCUMENT_OPTIONS).pipe(
              Effect.mapError((error) =>
                new Services.ResumePrintingService.ResumePrintError({
                  message: `DOCX conversion failed: ${error.message}`,
                  error: error.error,
                })
              ),
            )

            yield* Effect.logInfo(`[print] docx rendered: ${docxBytes.length} bytes`)

            return docxBytes
          }

          const pdfBytes = yield* Effect.tryPromise({
            async try() {
              const pdf = await page.pdf({
                printBackground: true,
                preferCSSPageSize: true,
              })
              return pdf instanceof Uint8Array ? pdf : new Uint8Array(pdf)
            },
            catch: (error) => renderError(error, fontFallbackUsed),
          })

          yield* Effect.logInfo(`[print] pdf rendered: ${pdfBytes.length} bytes`)

          return pdfBytes
        }),
      )

      return yield* renderDocument.pipe(
        // Backstop so the HTTP handler always resolves even if a CDP call hangs.
        // The interrupt propagates into the scoped session: logs drain and chrome
        // is closed/killed by its finalizers regardless.
        Effect.timeout(PRINT_BACKSTOP_TIMEOUT),
        Effect.mapError(
          flow(
            Match.value,
            Match.tag("PuppeteerError", (error) =>
              new Services.ResumePrintingService.ResumePrintError({
                message: error.message,
                error: error.error,
              })),
            Match.tag("TimeoutError", () =>
              new Services.ResumePrintingService.ResumePrintError({
                message: `Resume print did not complete within ${PRINT_BACKSTOP_TIMEOUT}`,
                error: null,
              })),
            Match.orElse((error) => error),
          ),
        ),
      )
    })
  }
}
