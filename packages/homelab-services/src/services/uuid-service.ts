import type { Effect } from "effect"
import { Context, Data, Schema } from "effect"

export const UuidServiceId = "homelab-api/services/uuid-service/UuidService"

export class UuidGenerationError extends Data.TaggedError("UuidGenerationError")<
  {
    readonly error: unknown
  }
> {}

export const UUIDSchema = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("homelab/UUID"),
)

export type UUID = typeof UUIDSchema.Type

export interface UuidServiceDef {
  /** Generates a new random UUID. */
  uuid(): Effect.Effect<UUID, UuidGenerationError>
}

export class UuidService extends Context.Service<UuidService, UuidServiceDef>()(UuidServiceId) {
}
