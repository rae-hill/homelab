import { Context, Data, Effect } from "effect"

export const HMACServiceId = "homelab-api/services/hmac-service/HMACService"

export class HMACDigestError extends Data.TaggedError("HMACDigestError")<
  {
    readonly error: unknown
  }
> {}

export interface HMACServiceDef {
  /** Computes an HMAC digest of the given string using the configured secret. */
  readonly hmacDigest: (data: string) => Effect.Effect<string, HMACDigestError>
}

export class HMACService extends Context.Service<HMACService, HMACServiceDef>()(HMACServiceId) {
}

/** {@inheritDoc HMACServiceDef.hmacDigest} */
export function hmacDigest(
  data: string,
): Effect.Effect<string, HMACDigestError, HMACService> {
  return HMACService.pipe(
    Effect.flatMap(
      (_) => _.hmacDigest(data),
    ),
  )
}
