---
name: frontend
description: Frontend architecture rules for packages/homelab-frontend: Astro, SolidJS, Effect, nanostores, and Kobalte conventions covering state management, URL sync, container/view component split, barrel exports, directory structure, and SSR. Use when writing or editing any frontend .ts, .tsx, or .astro code.
---

# Frontend Architecture & Design Principles

This project uses TypeScript, Astro, SolidJS, Effect, and Nanostores.

## State Management

### Single Source of Truth

- All application state lives in nanostores (`map` or `atom`). Components subscribe; they do not own state.
- Use `map<T>` for structured state with multiple keys. Use `atom<T>` only for simple scalar values.
- Use `computed` for derived state (e.g. `$wifiParams` derived from `$params`, `$isAuthenticated` derived from `$auth`).
- Never duplicate state across components. If two components need the same data, they subscribe to the same store.
- **Shared state must live in a single store.** If multiple pages share a piece of state (e.g. a tab selection), it belongs in one unified store — not duplicated per page.

### Option Over Empty Strings / Null

- Use `Option<T>` from Effect to represent values that may or may not be set.
- Never use empty strings as sentinel values for "not set." Empty string is a valid value; absence is `Option.none()`.
- Resolve defaults at the point of consumption (e.g. in effects or at render time via `Option.getOrElse`), not at the store level.
- For impure operations on Options (clipboard writes, DOM mutations), use `Option.match` with explicit `onNone`/`onSome` handlers rather than `Option.map`.

### URL ↔ Store Synchronization

- For URL-driven state, initialize the store from `URLSearchParams` at creation time (not after mount) to avoid loading flashes.
- Sync store changes back to the URL via `onSet` + `history.replaceState`.
- Use `Record.getSomes` from Effect to filter out `None` values before writing to the URL.
- Only `Some` values appear in the URL; `None` values are omitted to keep URLs clean.
- **All URL params live in one unified store** (`$params`). Each page's domain-specific params are exposed as `computed` stores derived from the unified store. This ensures:
  - Navigation between pages preserves the full query string automatically.
  - There is a single `syncURL` function — no per-page sync logic.
  - Tab state and cross-cutting concerns are shared without duplication.
- **Never read `window.location.search` for reactive values.** SolidJS does not track `window.location.search` — reading it in a component accessor produces stale values after `replaceState`. Always derive navigation hrefs from store state, which SolidJS tracks reactively.

### Navigation Hrefs

- Navigation links between pages must derive their `href` from the unified store, not from `window.location.search`.
- Container components compute the href as a reactive accessor (e.g. `const dnsHref = () => buildQS(allParams(), "/dns")`) and pass it as a prop to the view.
- This guarantees the href updates immediately when store state changes (e.g. clicking a tab), eliminating race conditions between state changes and link clicks.

### Minimizing Re-renders

- Use nanostores `map` with `setKey` for granular updates — only the changed key triggers re-renders.
- Use `computed` stores for derived values so subscribers only update when the derived value actually changes.
- Prefer `useStore` on the most specific store possible (e.g. `$wifiParams` rather than `$params` if you only need wifi fields).

## Component Architecture

### Separation of Concerns

- **Container components** (e.g. `WifiPage`) own logic: store subscriptions, effect invocations, validation, event handlers.
- **View components** (e.g. `WifiPageView`, `AppleTab`) are pure renderers: they receive props and call callbacks. No store access, no effects.
- View components define explicit prop interfaces that serve as API contracts with their consumers.

### Props as Contracts

- Props interfaces are the API boundary between container and view.
- Use `Option<T>` in props when the view needs to distinguish between "set" and "not set" (e.g. to show/hide UI or render placeholders).
- Use concrete types (not Option) when the container guarantees the value is present (e.g. after gating with `Option.all`).
- Callbacks in props are typed by their domain purpose, not their implementation (e.g. `onUsernameChange: (value: string) => void`).
- **Navigation hrefs are props, not computed inside views.** Views receive href strings from their container; they never read `window.location` or stores.

### Gating and Progressive Disclosure

- Use `Show` with `Option.all` to gate on required state before rendering a view.
- When required state is missing, show a setup/configuration view rather than an error screen.
- The setup view writes directly to the store (no local state duplication), so URL sync happens automatically.
- Use a `confirmed` signal to transition between setup and main views; auto-confirm if state is already present on load.

## Effect & Functional Patterns

### Pure Functions and Side Effects

- Business logic (validation, data transformation, default resolution) is pure.
- Side effects (API calls, clipboard, navigation) live inside Effect generators.
- Use `Effect.fn` for named, traceable effect functions.
- Use `yield*` on `Option` values inside Effects to short-circuit on `None` (produces `NoSuchElementException`).

### Dependency Injection

- Use Effect services and layers for dependencies (HTTP client, storage, config).
- Config values use `ConfigProvider` (Astro env vars via `AstroConfigProvider`).
- Never import environment variables directly in business logic; access them through Effect's config system.

### Error Handling

- Effects fail with typed errors. Callers handle errors at the boundary (`.catch` on `runPromise`).
- UI error handling uses toast notifications at the container level, not inside effects.

## Nanostores Conventions

- Store files export the store instance and any helpers (`setAuth`, `clearAuth`).
- `onSet` handlers are defined in the same file as the store for colocation.
- **`onSet` fires before the value is committed.** The callback receives `{ newValue, abort }`. Always use `newValue` from the callback parameter — never call `$store.get()` inside an `onSet` handler, as it returns the previous value.
- `onNotify` fires after the value is committed but before subscribers are notified. Use it when you need to read from `.get()` or perform side effects that depend on the new value being on the store.
- `task()` is used for async initialization (e.g. restoring from sessionStorage).
- For stores that need initial values from the environment (URL, storage), compute them synchronously at store creation time.
- **Computed stores for domain slices.** When a unified `map` store holds cross-domain state, expose domain-specific slices as `computed` stores (e.g. `$wifiParams = computed($params, p => ...)`). Consumers subscribe to the slice they need.

## File Organization

### Barrel Exports

- All `index.ts` barrel files use `export * as Namespace` — namespace re-exports, never individual named re-exports.
  ```typescript
  // lib/wifi/index.ts
  export * as Effects from "./effects.js"
  export * as State from "./state.js"
  ```
  ```typescript
  // lib/index.ts
  export * as Auth from "./auth/index.js"
  export * as Dns from "./dns/index.js"
  export * as Env from "./env.js"
  export * as Runtime from "./runtime.js"
  export * as State from "./state.js"
  export * as Wifi from "./wifi/index.js"
  ```
- Consumers outside `lib/` import from `lib/index.js` and access via namespace:
  ```typescript
  import * as Lib from "../../lib/index.js"

  Lib.Auth.State.$isAuthenticated
  Lib.Runtime.runEffect(Lib.Wifi.Effects.downloadAppleProfile())
  Lib.State.$params.setKey("tab", "android")
  ```
- Internal lib files import sibling domain barrels (never `lib/index.js` to avoid circular imports):
  ```typescript
  // lib/wifi/effects.ts
  import * as Auth from "../auth/index.js"
  import { API_BASE_URL } from "../env.js"
  ```

### Directory Structure

- Each feature domain (e.g. `wifi/`, `dns/`, `auth/`) has its own directory under `lib/`.
- Within a domain directory:
  - `state.ts` — stores, computed stores, types, and store-related helpers.
  - `effects.ts` — Effect-based side effects (API calls, downloads, clipboard).
  - `constants.ts` — string/numeric constants (storage keys, etc.) if needed.
  - `env.ts` — environment config values and feature flags.
  - `schema.ts` — Effect Schema definitions.
  - `utils.ts` — pure utility functions (crypto, encoding, etc.).
  - `index.ts` — barrel file with `export * as Namespace` from all sibling modules.
- Cross-cutting concerns live directly in `lib/` as standalone files:
  - `state.ts` — unified app params store, URL sync, reinit.
  - `env.ts` — ConfigProvider and Config-based env var accessors.
  - `runtime.ts` — Effect runtime (`runEffect`), not coupled to any domain.
  - `Loadable.ts` — generic loading state type.

## SSR Considerations

- Use `client:only="solid-js"` for components that use client-only APIs (Kobalte Select, portals, etc.).
- Guard `window`/`document` access with `typeof window !== "undefined"` in store initialization code.
- Store modules are safe to import during SSR as long as they don't call client APIs at the top level.
