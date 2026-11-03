import type { WritableDeep } from "type-fest"

export function asMutable<T>(thing: T): WritableDeep<T> {
  return thing as WritableDeep<T>
}
