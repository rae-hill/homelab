import { useEffect, useRef, useState } from "react"

export interface HideOnScrollParams {
  /** Don't start hiding until scrolled past this many px (keeps the top stable). */
  readonly threshold?: number
}

/**
 * Track scroll direction to drive a hide-on-scroll-down / show-on-scroll-up header.
 * Returns whether the element should currently be hidden.
 *
 * SSR-safe (listener attached in an effect). rAF-throttled; state only flips on a
 * direction change, so the consumer re-renders at most once per direction reversal.
 *
 * @returns `true` when the header should slide out of view.
 */
export function useHideOnScroll({ threshold = 64 }: HideOnScrollParams = {}): boolean {
  const [hidden, setHidden] = useState(false)
  const lastY = useRef(0)
  const ticking = useRef(false)

  useEffect(() => {
    lastY.current = window.scrollY

    function evaluate(): void {
      const y = window.scrollY
      const delta = y - lastY.current
      // Ignore tiny jitters; require a few px of intent before toggling.
      if (Math.abs(delta) > 4) {
        // Hide when scrolling down past the threshold; show when scrolling up (or near top).
        setHidden(delta > 0 && y > threshold)
        lastY.current = y
      }
      ticking.current = false
    }

    function onScroll(): void {
      if (!ticking.current) {
        ticking.current = true
        window.requestAnimationFrame(evaluate)
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [threshold])

  return hidden
}
