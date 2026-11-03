import type { DateTime } from "effect"
import { Context, Data, Effect } from "effect"
import type { HMACDigestError } from "./hmac-service.js"

export const NonceServiceId = "homelab-api/services/nonce-service/NonceService"

export class NonceValidationError extends Data.TaggedError("NonceValidationError")<
  {
    readonly reason: "invalid-format" | "invalid-hmac"
    readonly message: string
  }
> {}

export interface NonceServiceDef {
  /** Generates a time-bound nonce HMAC string for the given datetime. */
  readonly withTime: (time: DateTime.DateTime) => Effect.Effect<string, HMACDigestError>

  /** Validates a nonce, returning the embedded datetime if valid. */
  readonly validateNonce: (nonce: string) => Effect.Effect<DateTime.DateTime, NonceValidationError | HMACDigestError>
}

export class NonceService extends Context.Service<NonceService, NonceServiceDef>()(NonceServiceId) {
}

/** {@inheritDoc NonceServiceDef.withTime} */
export function withTime(
  time: DateTime.DateTime,
): Effect.Effect<string, HMACDigestError, NonceService> {
  return NonceService.pipe(
    Effect.flatMap(
      (_) => _.withTime(time),
    ),
  )
}

/** {@inheritDoc NonceServiceDef.validateNonce} */
export function validateNonce(
  nonce: string,
): Effect.Effect<DateTime.DateTime, NonceValidationError | HMACDigestError, NonceService> {
  return NonceService.pipe(
    Effect.flatMap(
      (_) => _.validateNonce(nonce),
    ),
  )
}
