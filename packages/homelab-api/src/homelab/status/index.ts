import { HttpApiGroup } from "effect/http-api"
import * as Health from "./health.js"
import * as Self from "./self.js"

export const StatusApi = HttpApiGroup.make("status")
  .add(Health.HealthEndpoint)
  .add(Self.SelfEndpoint)

export * as Health from "./health.js"
export * as Self from "./self.js"
