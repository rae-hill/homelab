import { configureStore } from "@reduxjs/toolkit"
import { useDispatch, useSelector } from "react-redux"

import { homelabReducer } from "../homelab/slice"
import { tailorReducer } from "../tailor/slice"
import { printConfigReducer } from "./slice"

/**
 * The app store: the `printConfig` slice, the `tailor` slice, and the `homelab` slice
 * (network reachability + OIDC auth for the remote-printing feature). Each
 * `PrintConfigProvider` instance builds its own store (see provider), which keeps SSR
 * isolated and makes the store trivially recreatable on the client.
 */
export function makeStore() {
  return configureStore({
    reducer: {
      printConfig: printConfigReducer,
      tailor: tailorReducer,
      homelab: homelabReducer,
    },
  })
}

export type AppStore = ReturnType<typeof makeStore>
export type RootState = ReturnType<AppStore["getState"]>
export type AppDispatch = AppStore["dispatch"]

/** Typed `useSelector` — components select the narrow slice they depend on. */
export const useAppSelector = useSelector.withTypes<RootState>()
/** Typed `useDispatch`. */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
