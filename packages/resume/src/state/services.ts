import { Effect, Layer } from "effect"
import { Layers } from "homelab-services-browser"

/**
 * The Effect runtime for browser-backed services (TailorEntryStoreService + PresetSnapshotService).
 * Mirrors the pattern from `homelab/runtime.ts`: a lazily-built, cached layer that depends on
 * browser-only globals (window.localStorage). No module-scoped mutable state beyond the cached
 * layer itself (acceptable — it's layer-owned, not service-owned).
 *
 * Usage: `runBrowser(program)` returns a Promise that runs the program with both services provided.
 * Effects are composed here; `runPromise` is only used at the React boundary (provider / thunks).
 */

/** Build the combined browser-services layer over window.localStorage. */
function makeBrowserLayer() {
  const port = {
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
    removeItem: (key: string) => window.localStorage.removeItem(key),
  }
  return Layer.merge(Layers.TailorEntryStoreServiceLive(port), Layers.PresetSnapshotServiceLive(port))
}

let cachedBrowserLayer: ReturnType<typeof makeBrowserLayer> | undefined

/** Lazily built (browser-only globals) and cached per page load. Returns undefined if SSR. */
export function browserLayer() {
  if (typeof window === "undefined") {
    return undefined
  }
  if (cachedBrowserLayer === undefined) {
    cachedBrowserLayer = makeBrowserLayer()
  }
  return cachedBrowserLayer
}

/**
 * Run a program that requires the browser services. Returns a Promise that resolves when the
 * program completes. No-op (resolves immediately) if called during SSR.
 */
export function runBrowser<A, E, R>(
  program: Effect.Effect<A, E, R>,
): Promise<A | undefined> {
  const layer = browserLayer()
  if (layer === undefined) {
    return Promise.resolve(undefined as A)
  }
  return Effect.runPromise(
    program.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>,
  )
}
