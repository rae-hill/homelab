import { Chunk, DateTime, Effect, flow, Layer, MutableHashMap, Option, Queue, Random, Ref, Tuple } from "effect"
import { Config, type Schemas, Services } from "homelab-services"
import puppeteer from "puppeteer-core"

/**
 * Puppeteer-backed PDF renderer for the resume site.
 *
 * The chrome executable comes from `CHROME_EXECUTABLE` (the nix derivation points it at
 * the store path of `google-chrome`); the site URL from `RESUME_SITE_URL` (defaults to
 * the production GitHub Pages origin). A browser is launched per request and closed in a
 * `finally` — simple, isolated, and crash-proof at resume-printing volume.
 *
 * Launch args are chosen for the hardened homelab-api systemd unit: `--no-sandbox`
 * (NoNewPrivileges + RestrictNamespaces forbid chrome's sandboxes) and
 * `--disable-dev-shm-usage` (PrivateDevices means no /dev/shm).
 */
export const PdfPrintServiceLive = Layer.effect(
  Services.PdfPrintService.PdfPrintService,
  Effect.gen(function*() {
    const env = yield* Config.Env.Env

    return new PdfPrintServiceImpl(env)
  }),
)

class PdfPrintServiceImpl implements Services.PdfPrintService.PdfPrintServiceDef {
  constructor(private readonly env: typeof Config.Env.Env.Service) {}

  printResume(configBase64: string, theme: Schemas.Resume.PrintTheme) {
    return Effect.gen({ self: this }, function*() {
      const executablePath = yield* Effect.fromOption(
        this.env.chromeExecutable,
        () =>
          new Services.PdfPrintService.PdfPrintError({
            message: "CHROME_EXECUTABLE is not set; PDF printing is unavailable on this deployment",
            error: null,
          }),
      )

      const url = new URL(this.env.resumeSiteUrl)
      url.searchParams.set("importPrintSettings", configBase64)
      url.searchParams.set("theme", theme)

      const defaultArgNameSymbol: symbol = Symbol()
      const countsRef = yield* Ref.make(MutableHashMap.empty<string | symbol, number>())
      /**
       * Here, Left => unclosed; Right => closed
       */
      const timerRef = yield* Ref.make(MutableHashMap.empty<string | symbol, DateTime.Utc>())
      const groupListRef = yield* Ref.make(Chunk.empty<string | symbol>())
      /**
       * Page console events are captured as ready-to-run log effects and drained
       * during cleanup (after `browser.close()`, so no further events can fire).
       * NOTE: this must NOT be a `Stream.runCollect` over a `Stream.callback` —
       * a callback stream never terminates, so collecting it hangs the request.
       */
      const logQueue = yield* Queue.unbounded<Effect.Effect<void>>()

      return yield* Effect.acquireUseRelease(
        Effect.tryPromise(
          {
            async try(signal) {
              const browser = await puppeteer.launch({
                executablePath,
                headless: true,
                args: [
                  "--no-sandbox",
                  "--disable-setuid-sandbox",
                  "--disable-dev-shm-usage",
                  "--disable-gpu",
                ],
                signal,
              })

              const page = await browser.newPage()

              page.on(
                "console",
                (msg) =>
                  Queue.offerUnsafe(
                    logQueue,
                    Effect.gen(function*() {
                      const type = msg.type()
                      const groups = yield* Ref.get(groupListRef)

                      switch (type) {
                        case "log":
                        case "dir":
                        case "table":
                          yield* Effect.log(...msg.args()).pipe(withSpans(groups))
                          break
                        case "info":
                          yield* Effect.logInfo(...msg.args()).pipe(withSpans(groups))
                          break
                        case "debug":
                        case "verbose":
                          yield* Effect.logDebug(...msg.args()).pipe(withSpans(groups))
                          break
                        case "error":
                        case "assert":
                          yield* Effect.logError(...msg.args()).pipe(withSpans(groups))
                          break
                        case "trace":
                          yield* Effect.logTrace(...msg.args()).pipe(withSpans(groups))
                          break
                        case "warn":
                          yield* Effect.logWarning(...msg.args()).pipe(withSpans(groups))
                          break
                        case "startGroup":
                        case "startGroupCollapsed": {
                          const msgArgs = msg.args()
                          const newGroupName = msgArgs.length > 0 ? msg.text() : defaultArgNameSymbol

                          yield* Ref.getAndUpdate(
                            groupListRef,
                            Chunk.prepend(newGroupName),
                          )

                          break
                        }
                        case "endGroup": {
                          yield* Ref.getAndUpdate(
                            groupListRef,
                            Chunk.drop(1),
                          )

                          break
                        }
                        case "count": {
                          const msgArgs = msg.args()
                          const countName = msgArgs.length > 0 ? msg.text() : defaultArgNameSymbol
                          const friendlyName = typeof countName === "string" ? countName : "default"

                          const newCount = yield* Ref.getAndUpdate(
                            countsRef,
                            MutableHashMap.modifyAt(
                              countName,
                              flow(Option.map((n) => n + 1), Option.orElseSome(() => 1)),
                            ),
                          ).pipe(
                            Effect.map(flow(MutableHashMap.get(countName), Option.getOrElse(() => 1))),
                          )

                          yield* Effect.logInfo(friendlyName + ": " + newCount)

                          break
                        }
                        // @ts-expect-error --- time isn't included for some reason
                        case "time":
                        // including profile to trigger this path in case puppeteer
                        // genuinely doesn't emit time events
                        case "profile": {
                          const msgArgs = msg.args()
                          const timerName = msgArgs.length > 0 ? msg.text() : defaultArgNameSymbol
                          const now = yield* DateTime.now
                          yield* Ref.getAndUpdate(
                            timerRef,
                            MutableHashMap.set(timerName, now),
                          )
                          break
                        }
                        // Note: this will treat time/profile as identical (one controlling the other)
                        // this is fine for now, not many browsers support profile anyway
                        case "timeEnd":
                        case "profileEnd": {
                          const msgArgs = msg.args()
                          const timerName = msgArgs.length > 0 ? msg.text() : defaultArgNameSymbol
                          const timerNameFriendly = typeof timerName === "string" ? timerName : "default"
                          const now = yield* DateTime.now
                          const timers = yield* Ref.get(timerRef)
                          const startTime = MutableHashMap.get(timers, timerName)

                          yield* startTime.pipe(
                            Option.map(
                              (start) => DateTime.toEpochMillis(now) - DateTime.toEpochMillis(start),
                            ),
                            Option.map(
                              Effect.fnUntraced(function*(diff) {
                                yield* Effect.logInfo(timerNameFriendly + ": " + diff + "ms")

                                MutableHashMap.remove(timers, timerName)
                              }),
                            ),
                            Effect.transposeOption,
                          )
                          break
                        }
                        default: {
                          const msgArgs = msg.args()

                          yield* Effect.logWarning("Unsupported log type: " + type, ...msgArgs)
                        }
                      }
                    }),
                  ),
              )

              return Tuple.make(browser, page)
            },
            catch(error) {
              return new Services.PdfPrintService.PdfPrintError({
                message: `Headless chrome failed to initialize`,
                error,
              })
            },
          },
        ),
        Effect.fn("puppeteer-run")(function*([, page]) {
          return yield* Effect.tryPromise({
            async try() {
              await page.goto(url.toString(), { waitUntil: "networkidle2", timeout: 60_000 })
              // The resume app sets `data-print-ready` on <html> once the imported config
              // and theme are applied to the redux store and the DOM has re-rendered.
              await page.waitForSelector("html[data-print-ready]", { timeout: 30_000 })
              const pdf = await page.pdf({
                printBackground: true,
                preferCSSPageSize: true,
              })
              return pdf instanceof Uint8Array ? pdf : new Uint8Array(pdf)
            },
            catch(error) {
              return new Services.PdfPrintService.PdfPrintError({
                message: `Headless chrome failed to render the resume PDF for ${url.origin}`,
                error,
              })
            },
          })
        }),
        Effect.fn("pupeteer-cleanup")(function*([browser]) {
          yield* Effect.tryPromise({
            try() {
              return browser.close()
            },
            catch(error) {
              return new Services.PdfPrintService.PdfPrintError({
                message: `Headless chrome failed to cleanup`,
                error,
              })
            },
          })

          // Drain the captured page-console log effects and run them so
          // browser-side logs land in the server logs/otel.
          const pendingLogs = yield* Queue.takeAll(logQueue)
          yield* Effect.forEach(pendingLogs, (logEffect) => logEffect)
          yield* Queue.shutdown(logQueue)
        }),
      )
    })
  }
}

function withSpans(
  spans: Chunk.Chunk<string | symbol>,
): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> {
  return (eff) => {
    return Effect.reduce(
      spans,
      () => eff,
      (wrapped, groupName) =>
        rhex.pipe(
          Effect.map(
            (id) => {
              const spanName = typeof groupName === "string" ? groupName : "unnamed-log-capture-group"

              return Effect.withSpan(wrapped, spanName + "-log-capture-group-" + id)
            },
          ),
        ),
    ).pipe(
      Effect.flatten,
    )
  }
}

const rhex: Effect.Effect<string> = Random.nextInt.pipe(Effect.map((_) => _.toString(16)))
