import { type ReactNode, useEffect, useRef } from "react"
import { Provider } from "react-redux"

import { parsePersisted, persistableSnapshot, PRINT_CONFIG_LOCAL_STORAGE_KEY } from "./persistence"
import { printConfigActions } from "./slice"
import { type AppStore, makeStore } from "./store"

interface PrintConfigProviderProps {
  children?: ReactNode | undefined
}

/**
 * Provides the Redux print-config store. CSR-safe: the store is created with
 * {@link initialPrintConfigState} (so SSR and the first client render agree), then a
 * one-shot client effect hydrates it from localStorage via a single `hydrate` action.
 * Subsequent store changes are written back (minus the ephemeral `editingEnabled`).
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
    return unsubscribe
  }, [store])

  return <Provider store={store}>{children}</Provider>
}
