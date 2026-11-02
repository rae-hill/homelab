import type { MutableRefObject } from "react"
import { useEffect, useRef } from "react"

export type BackgroundDepth = "landscape" | "mid-ground" | "foreground"

export interface ParallaxParams {
  readonly depth: BackgroundDepth
}

function getInitialScrollPosition(): number {
  try {
    return window.scrollY
  } catch {
    return 0
  }
}

/**
 * Parallax a background element: on scroll, translate it vertically at a fraction of the
 * scroll offset (the `depth` divisor), throttled to one update per animation frame.
 *
 * Imperative by design — the transform is written straight to `element.style` so scrolling
 * never triggers a React re-render.
 */
export function useParallax({
  depth,
}: ParallaxParams): MutableRefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  const currentScrollPos = useRef<number>(getInitialScrollPosition())
  const isAnimating = useRef<boolean>(false)

  useEffect(() => {
    const divisor = depthToDivisor(depth)

    function update(): void {
      if (ref.current !== null) {
        const amount = Math.max(currentScrollPos.current / divisor, 0)
        translateY(ref.current, `${amount}px`)
      }
      isAnimating.current = false
    }

    function onScroll(): void {
      currentScrollPos.current = window.scrollY
      if (!isAnimating.current) {
        isAnimating.current = true
        window.requestAnimationFrame(update)
      }
    }

    window.addEventListener("scroll", onScroll, false)
    return () => window.removeEventListener("scroll", onScroll, false)
  }, [depth])

  return ref
}

function depthToDivisor(depth: BackgroundDepth): number {
  switch (depth) {
    case "foreground":
      return 3 / 2
    case "mid-ground":
      return 2
    case "landscape":
      return 4
  }
}

function translateY(el: HTMLDivElement, amount: `${number}px`): void {
  const translation = `translate3d(0px, ${amount}, 0px)`
  el.style["-webkit-transform" as any] = translation
  el.style["-moz-transform" as any] = translation
  el.style["-ms-transform" as any] = translation
  el.style["-o-transform" as any] = translation
  el.style.transform = translation
}
