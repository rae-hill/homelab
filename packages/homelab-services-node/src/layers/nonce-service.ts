import { DateTime, Effect, Layer } from "effect"
import { Services } from "homelab-services"
import { Constants } from "shared"

export const NonceServiceLive = Layer.effect(
  Services.NonceService.NonceService,
  Effect.gen(function*() {
    const hmacService = yield* Services.HMACService.HMACService

    return new NonceServiceImpl(hmacService)
  }),
)

class NonceServiceImpl implements Services.NonceService.NonceServiceDef {
  constructor(private readonly hmacService: typeof Services.HMACService.HMACService.Service) {}

  withTime(time: DateTime.DateTime) {
    return Effect.gen({ self: this }, function*() {
      const epochSeconds = Math.floor(DateTime.toEpochMillis(time) / Constants.MS_PER_S)
      const timestamp = epochSeconds.toString()
      const hmac = yield* this.hmacService.hmacDigest(timestamp)

      return `${timestamp}.${hmac}`
    })
  }

  validateNonce(nonce: string) {
    return Effect.gen({ self: this }, function*() {
      const parts = nonce.split(".")
      if (parts.length !== 2) {
        return yield* new Services.NonceService.NonceValidationError({
          reason: "invalid-format",
          message: "Nonce must contain exactly two parts separated by a period",
        })
      }

      const [timestamp, hmac] = parts

      const epochSeconds = Number(timestamp)
      if (!Number.isFinite(epochSeconds)) {
        return yield* new Services.NonceService.NonceValidationError({
          reason: "invalid-format",
          message: "Nonce timestamp is not a valid number",
        })
      }

      const expectedHmac = yield* this.hmacService.hmacDigest(timestamp!)
      if (expectedHmac !== hmac) {
        return yield* new Services.NonceService.NonceValidationError({
          reason: "invalid-hmac",
          message: "Nonce HMAC verification failed",
        })
      }

      return DateTime.makeUnsafe(epochSeconds * Constants.MS_PER_S)
    })
  }
}
