import { createContext, useContext } from "react"

import { HIDE_EFFECTS_LOCAL_STORAGE_KEY } from "../constants/effects.constants"

function safeParseOrFalse(str: string | null) {
  try {
    return JSON.parse(str ?? "false")
  } catch (err) {
    console.error(`Failed to parse ${HIDE_EFFECTS_LOCAL_STORAGE_KEY}`)
    return "false"
  }
}

function getLocalHideEffectsValue(): string | null {
  try {
    return globalThis.localStorage.getItem(HIDE_EFFECTS_LOCAL_STORAGE_KEY)
  } catch (_) {
    return null
  }
}

export const InitialHideEffectContext = createContext(
  safeParseOrFalse(getLocalHideEffectsValue()),
)

export function useInitialHideEffectContext() {
  return useContext(InitialHideEffectContext)
}
