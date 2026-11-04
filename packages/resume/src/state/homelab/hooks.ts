import { Effect } from "effect"
import { useCallback, useEffect, useMemo } from "react"
import { Constants } from "shared"

import { useAppDispatch, useAppSelector } from "../print-config/store"
import { bootstrap, login, logout } from "./runtime"

/** Current reachability of the tailscale-only homelab API. */
export function useHomelabReachability() {
  return useAppSelector((s) => s.homelab.reachability)
}

/** Current OIDC auth state (status + signed-in profile). */
export function useHomelabAuth() {
  return useAppSelector((s) => s.homelab.auth)
}

/** Last homelab integration error message, or null. */
export function useHomelabError() {
  return useAppSelector((s) => s.homelab.error)
}

/**
 * True only when the API is reachable, the user is signed in, and their kanidm `roles`
 * claim carries `Resume_Print` — the gate for the download FAB.
 */
export function useCanPrintResume() {
  const auth = useHomelabAuth()
  const reachability = useHomelabReachability()
  return useMemo(
    () =>
      reachability === "reachable" &&
      auth.status === "signedIn" &&
      auth.roles.includes(Constants.RESUME_PRINT_ROLE),
    [reachability, auth],
  )
}

/** App-mount bootstrap: reachability probe + cached-session restore. Idempotent. */
export function useHomelabBootstrap() {
  const dispatch = useAppDispatch()
  useEffect(() => {
    void Effect.runPromise(bootstrap(dispatch))
  }, [dispatch])
}

/** Kick off the PKCE login redirect (navigates away). */
export function useLogin() {
  const dispatch = useAppDispatch()
  return useCallback(() => {
    void Effect.runPromise(login(dispatch))
  }, [dispatch])
}

/** Clear the local OIDC session. */
export function useLogout() {
  const dispatch = useAppDispatch()
  return useCallback(() => {
    void Effect.runPromise(logout(dispatch))
  }, [dispatch])
}
