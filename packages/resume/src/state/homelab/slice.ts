import { createSlice, type PayloadAction } from "@reduxjs/toolkit"
import { castDraft } from "immer"

/** Whether the tailscale-only homelab API answered a probe. */
export type Reachability = "unknown" | "checking" | "reachable" | "unreachable"

/** OIDC session status. `unknown` = still restoring a cached session on load. */
export type AuthStatus = "unknown" | "signedOut" | "signedIn"

export interface SignedInUser {
  readonly email: string | null
  readonly name: string | null
  readonly roles: ReadonlyArray<string>
  readonly expiresAt: number | null
}

export interface HomelabState {
  readonly reachability: Reachability
  readonly auth: { readonly status: AuthStatus } & SignedInUser
  /** Last auth/reachability error message (for a subtle inline hint), or null. */
  readonly error: string | null
}

/**
 * Immer drafts require mutable arrays, so the initial state widens `roles` to `string[]`
 * (structurally identical to {@link HomelabState} for consumers).
 */
const initialState = {
  reachability: "unknown" as Reachability,
  auth: {
    status: "unknown" as AuthStatus,
    email: null as string | null,
    name: null as string | null,
    roles: [] as string[],
    expiresAt: null as number | null,
  },
  error: null as string | null,
}

/**
 * The homelab slice: network reachability + OIDC auth state for the resume site. Kept in
 * the same Redux store as `printConfig` (see `print-config/store.ts`). All effectful work
 * (probing, PKCE login, session restore) happens in `runtime.ts` as Effects; this slice is
 * pure state transitions driven by dispatches at that boundary.
 */
export const homelabSlice = createSlice({
  name: "homelab",
  initialState,
  reducers: {
    setReachability(state, action: PayloadAction<Reachability>) {
      state.reachability = action.payload
    },
    setSignedIn(state, action: PayloadAction<SignedInUser>) {
      state.auth = castDraft({ status: "signedIn" as const, ...action.payload })
      state.error = null
    },
    setSignedOut(state) {
      state.auth = { status: "signedOut", email: null, name: null, roles: [], expiresAt: null }
    },
    setAuthUnknown(state) {
      state.auth = { status: "unknown", email: null, name: null, roles: [], expiresAt: null }
    },
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload
    },
  },
})

export const homelabActions = homelabSlice.actions
export const homelabReducer = homelabSlice.reducer
