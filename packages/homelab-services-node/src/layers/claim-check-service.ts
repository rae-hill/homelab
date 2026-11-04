import { DateTime, Effect, HashMap, Layer, Option } from "effect"
import { ApiErrors, type Identity, Services } from "homelab-services"
import * as Crypto from "node:crypto"
import { Constants } from "shared"

const CHECK_CLAIM_EXPIRATION = Constants.FIVE_MINUTES_SECONDS

class ClaimCheckServiceImpl implements Services.ClaimCheckService.ClaimCheckServiceDef {
  constructor(
    private claimCheckCache: HashMap.HashMap<
      string,
      readonly [identity: Identity.Identity, expiration: DateTime.DateTime]
    > = HashMap.empty(),
  ) {}

  issue(identity: Identity.Identity) {
    return Effect.gen({ self: this }, function*() {
      const expiration = yield* DateTime.now.pipe(
        Effect.map(
          DateTime.add({ seconds: CHECK_CLAIM_EXPIRATION }),
        ),
      )

      return yield* Effect.tryPromise({
        try: async () => {
          const bytes = Crypto.randomBytes(16).toString("hex")

          this.claimCheckCache = HashMap.set(this.claimCheckCache, bytes, [identity, expiration])

          return bytes
        },
        catch(error) {
          return new ApiErrors.InternalServerError({ error, message: "Failed to issue claim check" })
        },
      })
    })
  }

  validate(claimCheck: string): Effect.Effect<Identity.Identity, ApiErrors.AuthenticationError> {
    return Effect.gen({ self: this }, function*() {
      const cacheItem = HashMap.get(this.claimCheckCache, claimCheck)

      const identity = yield* Option.match(cacheItem, {
        onNone() {
          return Effect.fail(
            new ApiErrors.AuthenticationError({
              reason: "invalid-credential",
              message: "Claim check not recognized",
            }),
          )
        },
        onSome([identity, expiration]) {
          if (DateTime.isFuture(expiration)) {
            return Effect.succeed(identity)
          }

          return Effect.fail(
            new ApiErrors.AuthenticationError({
              reason: "expired-credential",
              message: "Claim Check has expired",
            }),
          )
        },
      })

      yield* Effect.sync(() => {
        this.claimCheckCache = HashMap.remove(this.claimCheckCache, claimCheck)
      })

      return identity
    })
  }
}

export const ClaimCheckServiceLive = Layer.succeed(
  Services.ClaimCheckService.ClaimCheckService,
  new ClaimCheckServiceImpl(),
)
