import type { SetStateAction } from "react"
import { useCallback, useEffect, useSyncExternalStore } from "react"

function dispatchStorageEvent(key: string, newValue: string | null) {
  window.dispatchEvent(new StorageEvent("storage", { key, newValue }))
}

function setLocalStorageItem(key: string, value: string) {
  const stringifiedValue = JSON.stringify(value)
  window.localStorage?.setItem(key, stringifiedValue)
  dispatchStorageEvent(key, stringifiedValue)
}

function removeLocalStorageItem(key: string) {
  window.localStorage?.removeItem(key)
  dispatchStorageEvent(key, null)
}

export function useLocalStorage(
  key: string,
  initialValue: string,
): readonly [string | null, (value: SetStateAction<string>) => void] {
  const store = useSyncExternalStore(
    function useLocalStorageSubscribe(callback) {
      window.addEventListener("storage", callback)
      return () => window.removeEventListener("storage", callback)
    },
    function getSnapshot() {
      return window.localStorage?.getItem(key) ?? initialValue
    },
    function getLocalStorageServerSnapshot(): string | null {
      return null
    },
  )

  const setState = useCallback(
    (v: SetStateAction<string>) => {
      if (store === null) {
        return
      }
      try {
        const nextState = typeof v === "function" ? v(JSON.parse(store)) : v

        if (nextState === undefined || nextState === null) {
          removeLocalStorageItem(key)
        } else {
          setLocalStorageItem(key, nextState)
        }
      } catch (e) {
        console.warn(e)
      }
    },
    [key, store],
  )

  useEffect(() => {
    if (window.localStorage?.getItem(key) === null) {
      setLocalStorageItem(key, initialValue)
    }
  }, [key, initialValue])

  return [store ? JSON.parse(store) : store, setState]
}
