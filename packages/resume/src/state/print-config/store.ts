import { configureStore } from "@reduxjs/toolkit"
import { useDispatch, useSelector } from "react-redux"

import { printConfigReducer } from "./slice"

/**
 * The app store. A single `printConfig` slice today; `configureStore` leaves room to add
 * slices later. Each `PrintConfigProvider` instance builds its own store (see provider),
 * which keeps SSR isolated and makes the store trivially recreatable on the client.
 */
export function makeStore() {
  return configureStore({
    reducer: {
      printConfig: printConfigReducer,
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
