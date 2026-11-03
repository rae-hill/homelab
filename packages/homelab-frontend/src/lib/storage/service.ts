import { Context, type Effect, type Option } from "effect"

export interface StorageServiceDef {
  readonly get: (key: string) => Effect.Effect<Option.Option<string>>
  readonly set: (key: string, value: string) => Effect.Effect<void>
  readonly remove: (key: string) => Effect.Effect<void>
}

export class StorageService
  extends Context.Service<StorageService, StorageServiceDef>()("homelab-frontend/StorageService")
{}
