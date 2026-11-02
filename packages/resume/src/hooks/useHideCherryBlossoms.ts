import { useLayoutEffect } from "react"
import { awaitEl } from "../util"

export async function hideCherryBlossoms(hide: boolean): Promise<void> {
  const result = await awaitEl("div:has(.confetties-iframe)", 100, 10000)

  if (result) {
    result.setAttribute("style", !hide ? "" : "display:none;")
  } else {
    console.warn("unable to find query 'div:has(.confetties-iframe)'")
  }
}

export function useInitialHideCherryBlossoms(hide: boolean = true) {
  useLayoutEffect(() => {
    async function queryForP5() {
      return hideCherryBlossoms(hide)
    }
    queryForP5()
  }, [hide])
}

export function HideCherryBlossoms() {
  useInitialHideCherryBlossoms()
  return null
}
