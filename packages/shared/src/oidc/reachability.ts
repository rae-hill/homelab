import { Duration, Effect } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"

/**
 * Probe whether the (tailscale-only) homelab API is reachable from this browser.
 *
 * Any HTTP response at all — even 401/403/500 — proves network reachability; only
 * transport failures/timeouts mean "unreachable" (off-tailnet, DNS blackhole, server
 * down). `/status/health` is guest-accessible, so no auth is needed.
 *
 * Self-contained: provides its own fetch-based `HttpClient` layer.
 */
export function checkReachable(
  apiBaseUrl: string | URL,
  timeout: Duration.Input = "10 seconds",
): Effect.Effect<boolean> {
  const url = new URL("/status/health", apiBaseUrl)
  return HttpClient.get(url.toString()).pipe(
    Effect.as(true),
    Effect.timeout(timeout),
    Effect.catch(() => Effect.succeed(false)),
    Effect.provide(FetchHttpClient.layer),
  )
}
