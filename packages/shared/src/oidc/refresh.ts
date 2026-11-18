import { ErrorResponse } from "oidc-client-ts"

/**
 * Pure helpers for the OIDC silent-refresh flow, shared by the `AuthService` and its
 * tests.
 *
 * Kanidm issues a refresh token on every PKCE code exchange (no `offline_access` scope
 * involved — requesting one would actually fail, since the client's scope-maps only grant
 * `openid profile email`). oidc-client-ts's `signinSilent()` prefers the stored refresh
 * token: a plain token-endpoint POST, no iframe and no extra redirect URI. Kanidm
 * **rotates** refresh tokens on every use and **destroys the whole OAuth2 session** when a
 * stale token is replayed, so concurrent refreshes (multiple tabs sharing one storage) must
 * be serialized — see {@link withRefreshLock}.
 */

/**
 * Refresh when the access token expires within this many seconds. Matches oidc-client-ts's
 * default `accessTokenExpiringNotificationTimeInSeconds` margin.
 */
export const REFRESH_MARGIN_SECONDS = 60

/**
 * Default key prefix of oidc-client-ts's `WebStorageStateStore`. Used to filter
 * same-origin `storage` events down to session writes from other tabs.
 */
export const SESSION_STORAGE_KEY_PREFIX = "oidc."

/** Prefix for the Web Lock name; scopes refresh serialization across same-origin tabs. */
const REFRESH_LOCK_PREFIX = "shared/oidc/refresh:"

/** The structural subset of an oidc-client-ts `User` that {@link shouldRefresh} inspects. */
export interface RefreshCandidate {
  readonly expired?: boolean | undefined
  readonly expires_in?: number | undefined
  readonly refresh_token?: string | undefined
}

/**
 * Whether a stored session should be renewed via the refresh-token grant: it carries a
 * refresh token AND the access token is expired or expires within
 * {@link REFRESH_MARGIN_SECONDS}. Sessions without a refresh token need an interactive
 * login redirect — silent renewal cannot save them (oidc-client-ts would fall back to the
 * iframe flow, which requires a `silent_redirect_uri` we deliberately do not register).
 */
export function shouldRefresh(user: RefreshCandidate | null | undefined): boolean {
  if (user === null || user === undefined) {
    return false
  }
  if (typeof user.refresh_token !== "string" || user.refresh_token === "") {
    return false
  }
  if (user.expired === true) {
    return true
  }
  return typeof user.expires_in === "number" && user.expires_in <= REFRESH_MARGIN_SECONDS
}

/** The Web Lock name serializing token refreshes for one OIDC client (per origin). */
export function refreshLockName(clientId: string): string {
  return `${REFRESH_LOCK_PREFIX}${clientId}`
}

/**
 * Run `fn` while holding a same-origin Web Lock, so two tabs never refresh the same
 * (rotating) Kanidm refresh token concurrently — replaying a rotated token destroys the
 * OAuth2 session server-side. Falls back to calling `fn` directly where
 * `navigator.locks` is unavailable (single-tab exposure only).
 */
export function withRefreshLock<T>(lockName: string, fn: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks
  if (locks === undefined || locks === null) {
    return fn()
  }
  return locks.request(lockName, fn) as Promise<T>
}

/**
 * Whether a failed refresh means the stored session is definitively dead (expired,
 * revoked, or replay-detected refresh token → Kanidm answers `invalid_grant`) and should
 * be discarded, as opposed to a transient failure (offline, timeout) where keeping the
 * session allows a later retry.
 */
export function isDefinitiveRefreshFailure(error: unknown): boolean {
  return error instanceof ErrorResponse && error.error === "invalid_grant"
}
