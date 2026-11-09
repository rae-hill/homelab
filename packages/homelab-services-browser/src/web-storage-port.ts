/**
 * Minimal abstraction over the Web Storage API (localStorage/sessionStorage).
 *
 * Provides a narrow, testable interface for storage operations without pulling
 * in the full Web API surface. Used by service implementations to read/write
 * persisted data while remaining compatible with browser localStorage.
 */
export interface WebStoragePort {
  /**
   * Retrieve the value associated with the given key.
   *
   * @param key - The storage key to look up
   * @returns The stored value, or null if the key doesn't exist
   */
  getItem: (key: string) => string | null

  /**
   * Store a value under the given key.
   *
   * @param key - The storage key
   * @param value - The value to store
   */
  setItem: (key: string, value: string) => void

  /**
   * Remove the value associated with the given key.
   *
   * @param key - The storage key to remove
   */
  removeItem: (key: string) => void
}
