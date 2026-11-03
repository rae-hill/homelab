import { Effect, FileSystem, Layer, Option, String } from "effect"
import { Config, Services } from "homelab-services"
import * as Crypto from "node:crypto"

export const HMACServiceLive = Layer.effect(
  Services.HMACService.HMACService,
  Effect.gen(function*() {
    const secretFilePath = yield* Config.Env.hmacSecretFilePath
    const fs = yield* FileSystem.FileSystem
    const secret = yield* secretFilePath.pipe(
      Option.map(fs.readFileString),
      Option.map(Effect.map(String.trim)),
      Effect.transposeOption,
    )

    return new HMACServiceImpl(secret)
  }),
)

class HMACServiceImpl implements Services.HMACService.HMACServiceDef {
  constructor(private readonly secret: Option.Option<string>) {}

  hmacDigest(data: string) {
    return Effect.gen({ self: this }, function*() {
      const secret = yield* this.secret.pipe(
        Option.match({
          onSome: Effect.succeed,
          onNone: () => Effect.fail(new Services.HMACService.HMACDigestError({ error: "Missing HMAC Secret" })),
        }),
      )

      return yield* Effect.try({
        try: () => Crypto.createHmac("sha256", secret).update(data).digest("hex"),
        catch: (error) => new Services.HMACService.HMACDigestError({ error }),
      })
    })
  }
}
