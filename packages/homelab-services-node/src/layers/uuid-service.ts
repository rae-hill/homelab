import { Effect, Layer, pipe, Schema } from "effect"
import { Services } from "homelab-services"
import { randomUUID } from "node:crypto"

class UuidServiceImpl implements Services.UuidService.UuidServiceDef {
  uuid(): Effect.Effect<Services.UuidService.UUID, Services.UuidService.UuidGenerationError> {
    return Effect.gen(function*() {
      const uuid = yield* Effect.try({
        try() {
          return randomUUID()
        },
        catch(error) {
          return new Services.UuidService.UuidGenerationError({
            error,
          })
        },
      })

      return yield* pipe(
        uuid,
        Schema.decodeEffect(Services.UuidService.UUIDSchema),
        Effect.orDie,
      )
    })
  }
}

export const UuidServiceLive = Layer.succeed(Services.UuidService.UuidService, new UuidServiceImpl())
