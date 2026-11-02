import { useLayoutEffect } from "react"
import { awaitClasses } from "../util"

export function useCorrectConfettiZIndex() {
  useLayoutEffect(() => {
    async function dispatchEffect() {
      const els = await awaitClasses("confetties-iframe")

      if (!els) {
        console.warn("Could not find 'confetties-iframe' class")
        return
      }

      for (let i = 0; i < els.length; ++i) {
        const el = els.item(i)!
        const currentStyle = el.getAttribute("style") ?? ""
        const replaced = currentStyle.replace(/z-index: \d+ !important;/, "")

        el.setAttribute("style", replaced)
      }
    }

    dispatchEffect()
  }, [])
}

export function CorrectConfettiIndex() {
  useCorrectConfettiZIndex()
  return null
}
