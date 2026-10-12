# Network Upgrade Redirect Plan

Automatically redirect users from the public guest deployment (`praeconinus.neko-bicolor.ts.net/ui`) to the full-featured internal deployment (`homelab.plato-splunk.media`) when the user is already on the home network or connected via Tailscale.

## Motivation

The public deployment at `praeconinus.neko-bicolor.ts.net/ui` is intentionally limited — guests can download a wifi profile but cannot access IDM or other internal services. Users who are already on the home network (or on Tailscale) don't need this restricted version and should be seamlessly upgraded to the full deployment with all features enabled.

## Detection Strategy

Attempt a `GET` request to `idm.plato-splunk.media/status`. This endpoint is only reachable from the home network or over Tailscale. If it returns a 200 within a short timeout, the user qualifies for upgrade.

## Behavior

1. On mount (or earliest possible event), fire the detection effect.
2. If the status check succeeds (HTTP 200, no timeout), redirect to `homelab.plato-splunk.media` preserving all current query parameters.
3. If the check fails (network error, timeout, non-200), do nothing — the user stays on the public deployment.
4. The redirect is a full navigation (`window.location.replace`), not a client-side route change.

---

## Implementation Plan

### 1. Add config values

In `src/lib/config.ts`, add:

```ts
export const UPGRADE_STATUS_URL = Config.string("PUBLIC_UPGRADE_STATUS_URL")
export const UPGRADE_TARGET_ORIGIN = Config.string(
  "PUBLIC_UPGRADE_TARGET_ORIGIN",
)
```

In `src/lib/config-provider.ts`, conditionally spread them (same pattern as OIDC vars):

```ts
...(import.meta.env.PUBLIC_UPGRADE_STATUS_URL != null &&
  { PUBLIC_UPGRADE_STATUS_URL: import.meta.env.PUBLIC_UPGRADE_STATUS_URL }),
...(import.meta.env.PUBLIC_UPGRADE_TARGET_ORIGIN != null &&
  { PUBLIC_UPGRADE_TARGET_ORIGIN: import.meta.env.PUBLIC_UPGRADE_TARGET_ORIGIN }),
```

Only the praeconinus `.env` will set these. When unset, the effect short-circuits (no redirect logic runs on the internal deployment).

### 2. Create the upgrade effect

New file: `src/lib/upgrade/index.ts`

```ts
import { HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform"
import { Effect } from "effect"
import { UPGRADE_STATUS_URL, UPGRADE_TARGET_ORIGIN } from "../config.js"

export const upgradeIfReachable = Effect.fn("upgradeIfReachable")(function*() {
  const statusUrl = yield* UPGRADE_STATUS_URL
  const targetOrigin = yield* UPGRADE_TARGET_ORIGIN

  const client = yield* HttpClient.HttpClient
  const request = HttpClientRequest.get(statusUrl)

  yield* client.execute(request).pipe(
    HttpClientResponse.filterStatusOk,
    Effect.timeout("3 seconds"),
    Effect.andThen(() =>
      Effect.sync(() => {
        const target = new URL(window.location.pathname, targetOrigin)
        target.search = window.location.search
        window.location.replace(target.toString())
      })
    ),
  )
})
```

Key design decisions:

- Uses `Effect.fn` for named, traceable effects (per steering docs).
- Config values accessed via Effect's config system, not `import.meta.env` directly.
- `yield* UPGRADE_STATUS_URL` short-circuits with a `ConfigError` when the env var is unset — this is the "feature flag" mechanism. On the internal deployment, the effect simply fails silently because the config isn't provided.
- 3-second timeout prevents blocking the UI on slow/unreachable networks.
- `filterStatusOk` ensures only a 200-range response triggers the redirect.
- `window.location.replace` (not `assign`) so the guest URL doesn't stay in browser history.
- Query params are preserved via `window.location.search`.

### 3. Invoke the effect on mount

In `src/components/WifiPage/WifiPage.tsx`, add to the existing `onMount`:

```ts
import { upgradeIfReachable } from "../../lib/upgrade/index.js"

onMount(() => {
  setMounted(true)
  runEffect(upgradeIfReachable()).catch(() => {})
})
```

The `.catch(() => {})` silently swallows all failures (config missing, network error, timeout). This is intentional — failure means "stay on current deployment."

### 4. Set env vars for praeconinus deployment

In the praeconinus `.env` (or Nix config that generates it):

```
PUBLIC_UPGRADE_STATUS_URL=https://idm.plato-splunk.media/status
PUBLIC_UPGRADE_TARGET_ORIGIN=https://homelab.plato-splunk.media
```

The internal deployment at `homelab.plato-splunk.media` does **not** set these, so the effect is inert there.

---

## Files Changed

| File                                   | Change                                            |
| -------------------------------------- | ------------------------------------------------- |
| `src/lib/config.ts`                    | Add `UPGRADE_STATUS_URL`, `UPGRADE_TARGET_ORIGIN` |
| `src/lib/config-provider.ts`           | Conditionally spread the two new env vars         |
| `src/lib/upgrade/index.ts`             | New file — the upgrade detection effect           |
| `src/components/WifiPage/WifiPage.tsx` | Call `upgradeIfReachable()` in `onMount`          |
| Praeconinus `.env` / Nix config        | Set the two `PUBLIC_UPGRADE_*` vars               |

## Edge Cases

- **User is on cellular (public guest):** Status check fails/times out → stays on praeconinus. Correct.
- **User is on home wifi:** Status check succeeds → redirected to full deployment. Correct.
- **User is on Tailscale (not home wifi):** Status check succeeds → redirected. Correct.
- **Internal deployment (`homelab.plato-splunk.media`):** Config vars unset → effect short-circuits immediately via `ConfigError`. No network request made. No redirect loop.
- **IDM is down:** Status check fails → user stays on public. Acceptable degradation.
- **Slow network:** 3-second timeout ensures the UI isn't blocked indefinitely.

## SSR Safety

The effect only runs inside `onMount` (client-side only, inside a `client:only="solid-js"` component), so no `window` access during SSR.
