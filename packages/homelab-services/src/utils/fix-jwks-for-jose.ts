import { Array } from "effect"
import { Utils } from "shared"
import type { JSONWebKeySet, JWK as JoseJWK } from "jose"
import type { JWK, JWKs } from "../schemas/OAuth.js"

export function fixJwksForJose({ keys }: JWKs): JSONWebKeySet {
  return Utils.asMutable({
    keys: Array.map(
      keys,
      fixJwkForJose,
    ),
  })
}

export function fixJwkForJose({ x5u, ...rest }: JWK): JoseJWK {
  return Utils.asMutable({
    ...rest,
    ...(x5u ? { x5u: x5u.toString() } : undefined),
  })
}
