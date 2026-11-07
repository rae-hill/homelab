import {
  Chunk,
  Context,
  Data,
  DateTime,
  Duration,
  Effect,
  flow,
  Formatter,
  HashSet,
  Layer,
  MutableHashMap,
  MutableRef,
  Option,
  Queue,
  Random,
  Ref,
} from "effect"
import { Config } from "homelab-services"
import puppeteer from "puppeteer-core"
import type { HTTPRequest, Page } from "puppeteer-core"

export const PuppeteerServiceId = "homelab-api/services-node/puppeteer/PuppeteerService"

/** Infrastructural failure of the headless browser itself (launch, page, interception). */
export class PuppeteerError extends Data.TaggedError("PuppeteerError")<{
  readonly message: string
  readonly error: unknown
}> {}

export interface WithPageOptions {
  /**
   * Requests whose URL matches are tracked in flight (Ref + HashSet) for stall
   * diagnostics (`session.pendingTrackedRequests`) and can be failed fast via
   * `session.abortTrackedRequests` (the font-stall fallback uses this).
   */
  readonly trackRequestsMatching?: RegExp
  /**
   * Extra chrome launch args, merged onto the hardened-unit baseline
   * (`--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu`).
   */
  readonly extraLaunchArgs?: ReadonlyArray<string>
}

/** What a `withPage` callback gets to drive: the raw page plus stall tooling. */
export interface PuppeteerSession {
  readonly page: Page
  /** How many tracked-host requests are still in flight (live; request handlers update the Ref synchronously). */
  readonly pendingTrackedRequests: Effect.Effect<number>
  /**
   * Enable request interception that ABORTS tracked-host requests (continuing
   * everything else). Call at most once per session, before a (re)load.
   */
  readonly abortTrackedRequests: Effect.Effect<void, PuppeteerError>
}

export interface PuppeteerServiceDef {
  /**
   * Launch a browser + open a page with observability handlers attached, run
   * `use`, and guarantee cleanup via scoped finalizers — even on failure or
   * INTERRUPTION (so callers can wrap this in `Effect.timeout` and still get
   * logs drained and chrome closed/killed). The Scope is internal: consumers
   * never carry an `R` requirement.
   *
   * Observability (everything flows through one queue consumed live by a forked
   * fiber, then drained by the finalizers — server-side logging is the reliable
   * channel: the resume SPA disables page `console.log` in production builds):
   * - page console messages → Effect.log* (with console.group/count/time tracking)
   * - requests/responses → debug (warn on failures and status >= 400)
   * - uncaught page exceptions → error
   * - dialogs → warn + dismiss (an unhandled dialog would block the page)
   * - new browser targets (popups!) → warn (pages) / debug (workers etc.)
   */
  readonly withPage: <A, E, R>(
    options: WithPageOptions,
    use: (session: PuppeteerSession) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | PuppeteerError, R>
}

export class PuppeteerService extends Context.Service<PuppeteerService, PuppeteerServiceDef>()(PuppeteerServiceId) {}

export const PuppeteerServiceLive = Layer.effect(
  PuppeteerService,
  Effect.gen(function*() {
    const env = yield* Config.Env.Env

    return new PuppeteerServiceImpl(env)
  }),
)

/** `browser.close()` gets this long before we SIGKILL the chrome process. */
const CLOSE_TIMEOUT_MS = 10_000

class PuppeteerServiceImpl implements PuppeteerServiceDef {
  constructor(private readonly env: typeof Config.Env.Env.Service) {}

  withPage<A, E, R>(
    options: WithPageOptions,
    use: (session: PuppeteerSession) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | PuppeteerError, R> {
    return Effect.scoped(
      Effect.gen({ self: this }, function*() {
        const executablePath = yield* Effect.fromOption(
          this.env.chromeExecutable,
          () =>
            new PuppeteerError({
              message: "CHROME_EXECUTABLE is not set; headless chrome is unavailable on this deployment",
              error: null,
            }),
        )

        // --- per-session observability state ---------------------------------
        const tracked = options.trackRequestsMatching
        /**
         * Captured browser events as ready-to-run log effects. A forked consumer
         * fiber runs them live (queue fully decoupled from the resource
         * lifecycle); the finalizers interrupt it and drain any stragglers.
         * NOTE: never `Stream.runCollect` a `Stream.callback` here — callback
         * streams don't terminate and collecting one hangs forever.
         */
        const logQueue = yield* Queue.unbounded<Effect.Effect<void>>()
        /**
         * Tracked-host requests currently in flight (the stall signature).
         * Request handlers mutate this synchronously via the underlying
         * MutableRef cell: queue-deferred Ref updates would lag the consumer
         * fiber and be stale at the font-stall decision point. `Ref.get` on
         * the read side stays an Effect (session.pendingTrackedRequests).
         */
        const trackedRequests = Ref.makeUnsafe(HashSet.empty<HTTPRequest>())
        // console.group/count/time bookkeeping for faithful server-side replay
        const defaultArgNameSymbol: symbol = Symbol()
        const groupListRef = yield* Ref.make(Chunk.empty<string | symbol>())
        const countsRef = yield* Ref.make(MutableHashMap.empty<string | symbol, number>())
        const timerRef = yield* Ref.make(MutableHashMap.empty<string | symbol, DateTime.Utc>())

        // Handler callbacks are plain JS; every captured effect is guarded so a
        // defect (e.g. Formatter touching a JSHandle whose execution context was
        // destroyed by a reload) can never kill the consumer fiber or a finalizer.
        const offerLog = (logEffect: Effect.Effect<void>) => {
          Queue.offerUnsafe(
            logQueue,
            logEffect.pipe(
              Effect.catchDefect((defect) => Effect.logError("page observability effect defect:", defect)),
            ),
          )
        }

        // --- browser (scoped) -------------------------------------------------
        const browser = yield* Effect.tryPromise({
          async try(signal) {
            return await puppeteer.launch({
              executablePath,
              headless: true,
              // Launch args are chosen for the hardened homelab-api systemd unit:
              // `--no-sandbox` (NoNewPrivileges + RestrictNamespaces forbid chrome's
              // sandboxes) and `--disable-dev-shm-usage` (PrivateDevices means no
              // /dev/shm). Callers may append more via options.extraLaunchArgs.
              args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                ...(options.extraLaunchArgs ?? []),
              ],
              signal,
            })
          },
          catch(error) {
            return new PuppeteerError({
              message: `Headless chrome failed to initialize`,
              error,
            })
          },
        })

        // Finalizer (added first ⇒ runs LAST): bounded close + SIGKILL fallback,
        // then a straggler drain for events that fired during close. Cleanup must
        // never hang the request nor mask the use-step result — close() was
        // observed hanging on augustus, and SIGKILL definitively ends chrome.
        yield* Effect.addFinalizer(
          Effect.fn("puppeteer-close")(function*() {
            yield* Effect.tryPromise({
              try() {
                return browser.close()
              },
              catch(error) {
                return new PuppeteerError({
                  message: `Headless chrome failed to cleanup`,
                  error,
                })
              },
            }).pipe(
              // Bound the wait with Effect's own scheduling (no raw timers/Promise.race):
              // on timeout the close fiber is interrupted — the hung browser.close()
              // promise stays dangling but handled (tryPromise attached its callbacks,
              // so no unhandled rejection) — and TimeoutError joins the error channel.
              Effect.timeout(Duration.millis(CLOSE_TIMEOUT_MS)),
              // Cleanup trouble must never hang the request nor mask the real
              // (use-step) result — browser.close() was observed hanging on
              // augustus. SIGKILL the chrome process as the last resort: after
              // that the browser is definitively gone, so log and succeed.
              Effect.catch((cleanupError) =>
                Effect.sync(() => {
                  const chromeProcess = browser.process()
                  if (chromeProcess !== null && chromeProcess.exitCode === null) {
                    chromeProcess.kill("SIGKILL")
                  }
                }).pipe(
                  Effect.andThen(
                    Effect.logWarning(
                      `Force-killed headless chrome after a failed close or a ${CLOSE_TIMEOUT_MS}ms close timeout:`,
                      cleanupError,
                    ),
                  ),
                )
              ),
            )

            // Queue.clear never parks (empty ⇒ []), so it is safe to await
            // inside a scope finalizer — see the drain-finalizer comment below.
            const stragglers = yield* Queue.clear(logQueue)
            yield* Effect.forEach(stragglers, (logEffect) => logEffect)
          }),
        )

        // --- page + handlers ---------------------------------------------------
        const page = yield* Effect.tryPromise({
          try() {
            return browser.newPage()
          },
          catch(error) {
            return new PuppeteerError({
              message: `Headless chrome failed to open a page`,
              error,
            })
          },
        })

        page.on("request", (request) => {
          const url = request.url()
          offerLog(Effect.logDebug(`[page request] ${request.method()} ${url} (${request.resourceType()})`))
          if (tracked !== undefined && tracked.test(url)) {
            // Synchronous mutation — see the `trackedRequests` comment.
            MutableRef.update(trackedRequests.ref, HashSet.add(request))
          }
        })
        page.on("requestfinished", (request) => {
          if (tracked !== undefined && tracked.test(request.url())) {
            MutableRef.update(trackedRequests.ref, HashSet.remove(request))
          }
        })
        page.on("requestfailed", (request) => {
          offerLog(
            Effect.logWarning(
              `[page request FAILED] ${request.method()} ${request.url()}: ${
                request.failure()?.errorText ?? "unknown"
              }`,
            ),
          )
          if (tracked !== undefined && tracked.test(request.url())) {
            MutableRef.update(trackedRequests.ref, HashSet.remove(request))
          }
        })
        page.on("response", (response) => {
          const status = response.status()
          const line = `[page response] ${status} ${response.url()}`
          offerLog(status >= 400 ? Effect.logWarning(line) : Effect.logDebug(line))
        })
        page.on("pageerror", (error) => {
          offerLog(Effect.logError("[page uncaught exception]", String(error)))
        })
        page.on("dialog", (dialog) => {
          // A dialog nobody handles blocks the page; log and dismiss.
          offerLog(Effect.logWarning(`[page dialog] ${dialog.type()}: ${dialog.message()}`))
          void dialog.dismiss().catch(() => {})
        })
        browser.on("targetcreated", (target) => {
          // Popups (e.g. a misbehaving third-party embed on the wrong domain).
          const line = `[browser target created] ${target.type()}: ${target.url()}`
          offerLog(target.type() === "page" ? Effect.logWarning(line) : Effect.logDebug(line))
        })

        page.on(
          "console",
          (msg) =>
            offerLog(
              Effect.gen(function*() {
                const type = msg.type()
                const groups = yield* Ref.get(groupListRef)
                const msgArgs = msg.args()
                const logLines = msgArgs.length === 0 ? [msg.text()] : Formatter.format(msgArgs)

                switch (type) {
                  case "log":
                  case "dir":
                  case "table":
                    yield* Effect.log(...logLines).pipe(withSpans(groups))
                    break
                  case "info":
                    yield* Effect.logInfo(...logLines).pipe(withSpans(groups))
                    break
                  case "debug":
                  case "verbose":
                    yield* Effect.logDebug(...logLines).pipe(withSpans(groups))
                    break
                  case "error":
                  case "assert":
                    yield* Effect.logError(...logLines).pipe(withSpans(groups))
                    break
                  case "trace":
                    yield* Effect.logTrace(...logLines).pipe(withSpans(groups))
                    break
                  case "warn":
                    yield* Effect.logWarning(...logLines).pipe(withSpans(groups))
                    break
                  case "startGroup":
                  case "startGroupCollapsed": {
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
                    yield* Effect.logWarning("Unsupported log type: " + type, ...msgArgs)
                  }
                }
              }),
            ),
        )

        // --- log draining on scope close ---------------------------------------
        // Finalizers run in REVERSE registration order, so close unwinds as:
        // consumer interrupt (forked last ⇒ released first; forkScoped discards
        // the interrupted fiber's cause — a parked take dying here is clean),
        // then THIS drain, then the bounded browser close. `Queue.clear` is the
        // only safe drain primitive: `takeAll` parks on an empty open queue — an
        // unkillable deadlock inside an uninterruptible scope close — and
        // `shutdown` finalizes the queue with an interrupt-shaped exit that a
        // later take delivers to the closer fiber itself, turning scope close
        // into a failure that REPLACES the use-step's success (→ 503). This
        // finalizer cannot fail: `offerLog` wraps every queued effect in
        // catchDefect. The close finalizer does one last straggler pass for
        // events that fire during shutdown.
        yield* Effect.addFinalizer(
          Effect.fn("puppeteer-drain-logs")(function*() {
            const pendingLogs = yield* Queue.clear(logQueue)
            yield* Effect.forEach(pendingLogs, (logEffect) => logEffect)
          }),
        )

        // --- live log consumer (decouples the queue from acquire/use/release) ---
        // Forked LAST so its interrupt finalizer runs FIRST at close, releasing
        // in-flight log effects before the drain above collects the stragglers.
        yield* Effect.forkScoped(
          Queue.take(logQueue).pipe(
            Effect.andThen((logEffect) => logEffect),
            Effect.forever,
          ),
        )

        const session: PuppeteerSession = {
          page,
          pendingTrackedRequests: Ref.get(trackedRequests).pipe(Effect.map(HashSet.size)),
          abortTrackedRequests: Effect.tryPromise({
            async try() {
              await page.setRequestInterception(true)
              page.on("request", (request) => {
                // `continue()` REJECTS for `data:` URLs (they skip interception
                // but still see interception.enabled) — swallow or these become
                // unhandled rejections.
                if (tracked !== undefined && tracked.test(request.url())) {
                  void request.abort().catch(() => {})
                } else {
                  void request.continue().catch(() => {})
                }
              })
            },
            catch(error) {
              return new PuppeteerError({
                message: `Headless chrome failed to enable request interception`,
                error,
              })
            },
          }),
        }

        return yield* use(session)
      }),
    )
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
