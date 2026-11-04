import { Effect, Option } from "effect"
import { AuthService, checkReachable, DEFAULT_OIDC_SCOPE, layer as buildAuthLayer, type OidcUser } from "shared/oidc"

import { homelabEnv } from "../../env"
import type { AppDispatch } from "../print-config/store"
import { homelabActions, type SignedInUser } from "./slice"

/**
 * The Effect ⇄ Redux bridge for the homelab integration. All effectful work is composed
 * as Effects here; `Effect.runPromise` is only used at the React boundary (provider /
 * route effects), and results land in the store via dispatches.
 */

/** OIDC callback route (TanStack file route `src/routes/oauth-callback.tsx`). */
export const OAUTH_CALLBACK_PATH = "/oauth-callback"

function makeAuthLayer() {
  return buildAuthLayer({
    authority: homelabEnv.oidcAuthority,
    clientId: homelabEnv.oidcClientId,
    redirectUri: `${globalThis.location.origin}${OAUTH_CALLBACK_PATH}`,
    scope: DEFAULT_OIDC_SCOPE,
    postLogoutRedirectUri: globalThis.location.origin,
  })
}

let cachedAuthLayer: ReturnType<typeof makeAuthLayer> | undefined

/** Lazily built (browser-only globals) and cached per page load. */
function authLayer(): ReturnType<typeof makeAuthLayer> {
  if (cachedAuthLayer === undefined) {
    cachedAuthLayer = makeAuthLayer()
  }
  return cachedAuthLayer
}

/** Lift a redux dispatch into a synchronous Effect. */
const dispatched = (dispatch: AppDispatch) => {
  const send = (action: Parameters<AppDispatch>[0]) => Effect.sync(() => dispatch(action))
  return {
    unreachable: send(homelabActions.setReachability("unreachable")),
    checking: send(homelabActions.setReachability("checking")),
    reachable: (reachable: boolean) => send(homelabActions.setReachability(reachable ? "reachable" : "unreachable")),
    signedIn: (user: SignedInUser) => send(homelabActions.setSignedIn(user)),
    signedOut: send(homelabActions.setSignedOut()),
    error: (message: string) => send(homelabActions.setError(message)),
  }
}

function toSignedInUser(user: OidcUser): SignedInUser {
  return {
    email: Option.getOrNull(user.email),
    name: Option.getOrNull(user.name),
    roles: user.roles,
    expiresAt: Option.getOrNull(user.expiresAt),
  }
}

/**
 * One-shot app bootstrap: probe the tailscale-only API for reachability, then restore any
 * cached OIDC session from session storage. Never fails — errors become store state.
 */
export function bootstrap(dispatch: AppDispatch): Effect.Effect<void> {
  return Effect.gen(function*() {
    const actions = dispatched(dispatch)

    if (!homelabEnv.enabled) {
      yield* actions.unreachable
      yield* actions.signedOut
      return
    }

    yield* actions.checking
    const reachable = yield* checkReachable(homelabEnv.apiUrl)
    yield* actions.reachable(reachable)

    const auth = yield* AuthService
    const user = yield* auth.getUser()
    if (Option.isSome(user)) {
      yield* actions.signedIn(toSignedInUser(user.value))
    } else {
      yield* actions.signedOut
    }
  }).pipe(
    Effect.provide(authLayer()),
    Effect.catch((error) =>
      Effect.gen(function*() {
        yield* dispatched(dispatch).error(error.message)
        yield* dispatched(dispatch).signedOut
      })
    ),
  )
}

/**
 * Start the PKCE login redirect. Navigates the page away on success; only failures
 * resolve (into an error dispatch).
 */
export function login(dispatch: AppDispatch): Effect.Effect<void> {
  return Effect.gen(function*() {
    const auth = yield* AuthService
    yield* auth.login()
  }).pipe(
    Effect.provide(authLayer()),
    Effect.catch((error) => dispatched(dispatch).error(error.message)),
  )
}

/**
 * Complete the OIDC redirect on the callback route. Returns whether sign-in succeeded so
 * the route can navigate home or show an error.
 */
export function completeLoginCallback(dispatch: AppDispatch): Effect.Effect<boolean> {
  return Effect.gen(function*() {
    const auth = yield* AuthService
    const user = yield* auth.handleRedirectCallback()
    yield* dispatched(dispatch).signedIn(toSignedInUser(user))
    return true
  }).pipe(
    Effect.provide(authLayer()),
    Effect.catch((error) =>
      Effect.gen(function*() {
        yield* dispatched(dispatch).error(error.message)
        yield* dispatched(dispatch).signedOut
        return false
      })
    ),
  )
}

/** Clear the local OIDC session (no IdP redirect). */
export function logout(dispatch: AppDispatch): Effect.Effect<void> {
  return Effect.gen(function*() {
    const auth = yield* AuthService
    yield* auth.signout()
    yield* dispatched(dispatch).signedOut
  }).pipe(
    Effect.provide(authLayer()),
    Effect.catch((error) => dispatched(dispatch).error(error.message)),
  )
}
