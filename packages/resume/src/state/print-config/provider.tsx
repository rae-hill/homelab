import { Effect } from "effect"
import { type ReactNode, useEffect, useRef } from "react"
import { Provider } from "react-redux"

import { decodeBase64Config, parsePersisted, persistableSnapshot, PRINT_CONFIG_LOCAL_STORAGE_KEY } from "./persistence"
import { printConfigActions } from "./slice"
import { type AppStore, makeStore } from "./store"

interface PrintConfigProviderProps {
  children?: ReactNode | undefined
}

/** The query param carrying a base64 persisted config to apply on load (see plan Phase 3). */
const IMPORT_PARAM = "importPrintSettings"

/**
 * Provides the Redux app store (print-config + homelab slices). CSR-safe: the store is
 * created with {@link initialPrintConfigState} (so SSR and the first client render agree),
 * then a one-shot client effect hydrates it from localStorage via a single `hydrate`
 * action. Subsequent store changes are written back (minus the ephemeral `editingEnabled`).
 *
 * The same effect then applies a `?importPrintSettings=<base64>` URL param **over** the
 * hydrated state (this is how the puppeteer print flow injects a config). The raw param
 * value is never rendered — it flows base64 → shared-schema decode → redux → React text
 * nodes only, so React's default escaping covers it (no HTML is ever built from it). A
 * decode failure is logged and ignored (state stays as hydrated).
 *
 * Finally, once fonts are ready it marks `document.documentElement` with
 * `data-print-ready="true"` — the signal headless chrome waits for before `page.pdf()`.
 *
 * The store lives in a ref so it's created exactly once per provider instance.
 */
export function PrintConfigProvider({ children }: PrintConfigProviderProps) {
  const storeRef = useRef<AppStore | null>(null)
  if (storeRef.current === null) {
    storeRef.current = makeStore()
  }
  const store = storeRef.current

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }
    // One-shot hydration from localStorage.
    let raw: string | null
    try {
      raw = window.localStorage.getItem(PRINT_CONFIG_LOCAL_STORAGE_KEY)
    } catch {
      raw = null
    }
    if (raw !== null) {
      store.dispatch(printConfigActions.hydrate(parsePersisted(raw)))
    }

    // Apply a URL-borne config on top of the hydrated state (puppeteer / share links).
    const imported = new URLSearchParams(window.location.search).get(IMPORT_PARAM)
    if (imported !== null) {
      const decoded = decodeBase64Config(imported)
      if (decoded !== null) {
        store.dispatch(printConfigActions.applyConfig(decoded))
      }
    }

    // Persist on every subsequent change.
    const unsubscribe = store.subscribe(() => {
      try {
        window.localStorage.setItem(
          PRINT_CONFIG_LOCAL_STORAGE_KEY,
          persistableSnapshot(store.getState().printConfig),
        )
      } catch {
        // Ignore quota / unavailable-storage errors — persistence is best-effort.
      }
    })

    // Signal print-readiness for the headless-chrome print flow once fonts have loaded.
    void Effect.runPromise(
      Effect.tryPromise(() => document.fonts.ready).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            document.documentElement.setAttribute("data-print-ready", "true")
          })
        ),
        Effect.catch(() =>
          // Fonts API unavailable — still mark ready so printing never hangs.
          Effect.sync(() => {
            document.documentElement.setAttribute("data-print-ready", "true")
          })
        ),
      ),
    )

    return unsubscribe
  }, [store])

  return <Provider store={store}>{children}</Provider>
}
