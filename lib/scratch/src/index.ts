/**
 * Throwaway proof-of-concept library for the `lib/*` → npm publishing pipeline.
 *
 * Everything in here exists to exercise the build → docs → release → publish
 * flow end to end. See `docs/npm-lib-publishing-plan.md` at the repo root.
 *
 * @packageDocumentation
 */

/**
 * Greets `name` with unbearable enthusiasm.
 *
 * @param name - The greetee.
 * @returns An exclamation-laden greeting.
 *
 * @example
 * ```ts
 * import { greet } from "@rae-hill/scratch"
 *
 * greet("world") //=> "Hello, world!"
 * ```
 */
export const greet = (name: string): string => `Hello, ${name}!`

/**
 * Converts arbitrary text into a URL-friendly slug.
 *
 * Strips diacritics, lowercases, and replaces runs of non-alphanumeric
 * characters with single hyphens.
 *
 * @param input - The text to slugify.
 * @returns The slug (empty string when nothing alphanumeric remains).
 *
 * @example
 * ```ts
 * import { slugify } from "@rae-hill/scratch"
 *
 * slugify("Crème Brûlée — Recipe!") //=> "creme-brulee-recipe"
 * ```
 */
export const slugify = (input: string): string =>
  input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

/**
 * Clamps `value` into the inclusive range `[min, max]`.
 *
 * @param value - The number to clamp.
 * @param min - Lower bound (must be <= max).
 * @param max - Upper bound.
 * @returns `min` when value < min, `max` when value > max, else `value`.
 *
 * @example
 * ```ts
 * import { clamp } from "@rae-hill/scratch"
 *
 * clamp(15, 0, 10) //=> 10
 * ```
 */
export const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

/**
 * Sums a list of numbers.
 *
 * @param values - The addends.
 * @returns The total (0 for an empty list).
 *
 * @example
 * ```ts
 * import { sum } from "@rae-hill/scratch"
 *
 * sum([1, 2, 3]) //=> 6
 * ```
 */
export const sum = (values: ReadonlyArray<number>): number => values.reduce((total, value) => total + value, 0)
