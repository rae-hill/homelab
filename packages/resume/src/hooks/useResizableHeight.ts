import { useCallback, useRef } from "react"

/** Pointer handlers for the drag bar, plus the ref to attach to the resizable element. */
export interface ResizableHeight {
  /** Attach to the element whose height is dragged (the modal content). */
  readonly ref: (node: HTMLDivElement | null) => void
  /** Spread onto the drag-bar element (`<div {...handleProps} />`). */
  readonly handleProps: {
    readonly onPointerDown: (event: React.PointerEvent) => void
    readonly role: "separator"
    readonly "aria-orientation": "horizontal"
    readonly "aria-label": string
  }
}

export interface ResizableHeightParams {
  /** Minimum height in pixels. Defaults to 160. */
  readonly minPx?: number
  /** Maximum height as a fraction of the viewport height (0–1). Defaults to 1 (full). */
  readonly maxViewportFraction?: number
}

/**
 * Drag-to-resize for a bottom-anchored panel, done imperatively (à la `useParallax`):
 * pointer moves mutate `element.style.height` directly rather than going through React
 * state, so dragging never triggers a re-render.
 *
 * The panel grows from its fixed bottom edge, so dragging the handle **up** increases
 * height and **down** decreases it (`height = startHeight + (startY - pointerY)`), clamped
 * between `minPx` and `maxViewportFraction * innerHeight`.
 *
 * No initial height is set, so the element keeps its CSS-defined (responsive, per-platform)
 * default until the user first drags; remounting on reopen restores that default.
 */
export function useResizableHeight({
  maxViewportFraction = 1,
  minPx = 160,
}: ResizableHeightParams = {}): ResizableHeight {
  const elRef = useRef<HTMLDivElement | null>(null)

  const ref = useCallback((node: HTMLDivElement | null) => {
    elRef.current = node
  }, [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const el = elRef.current
      if (el === null) {
        return
      }
      event.preventDefault()
      const startY = event.clientY
      const startHeight = el.getBoundingClientRect().height
      const maxPx = window.innerHeight * maxViewportFraction

      // Capture the pointer on the handle so the drag keeps tracking outside the bar.
      const handle = event.currentTarget as HTMLElement
      handle.setPointerCapture?.(event.pointerId)

      function onMove(moveEvent: PointerEvent): void {
        if (elRef.current === null) {
          return
        }
        const next = Math.min(
          Math.max(startHeight + (startY - moveEvent.clientY), minPx),
          maxPx,
        )
        elRef.current.style.height = `${next}px`
      }

      function onUp(): void {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        handle.releasePointerCapture?.(event.pointerId)
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
    },
    [minPx, maxViewportFraction],
  )

  return {
    ref,
    handleProps: {
      onPointerDown,
      role: "separator",
      "aria-orientation": "horizontal",
      "aria-label": "Resize settings panel",
    },
  }
}
