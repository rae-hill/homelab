import { useEffect, useRef } from "react"

/**
 * The Konami code sequence, expressed as `KeyboardEvent.key` values:
 * up, up, down, down, left, right, left, right, A, B, Enter.
 */
const KONAMI_SEQUENCE: ReadonlyArray<string> = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "a",
  "b",
  "Enter",
]

/**
 * Fire `onUnlock` when the user enters the Konami code. SSR-safe (the `keydown` listener
 * is attached inside an effect, so `window` is never touched during render).
 *
 * Progress is tracked in a ref so re-renders don't reset it; a non-matching key rewinds
 * to the start (but still counts the key as a potential new first step). Letter keys are
 * compared case-insensitively so Caps Lock / Shift don't break the `a` / `b` steps.
 *
 * @param onUnlock - Called once each time the full sequence is completed.
 */
export function useKonamiCode(onUnlock: () => void): void {
  // Keep the latest callback without re-subscribing the listener on every render.
  const onUnlockRef = useRef(onUnlock)
  onUnlockRef.current = onUnlock

  useEffect(() => {
    let progress = 0

    function matches(key: string, expected: string): boolean {
      return expected.length === 1 ?
        key.toLowerCase() === expected.toLowerCase()
        : key === expected
    }

    function onKeyDown(event: KeyboardEvent): void {
      const expected = KONAMI_SEQUENCE[progress]
      if (matches(event.key, expected)) {
        progress += 1
        if (progress === KONAMI_SEQUENCE.length) {
          progress = 0
          onUnlockRef.current()
        }
        return
      }
      // Mismatch: rewind, but allow this key to start a fresh attempt.
      progress = matches(event.key, KONAMI_SEQUENCE[0]) ? 1 : 0
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}
