import type { Effect } from "effect"
import { Context } from "effect"

import type * as Schemas from "../schemas/index.js"

export const RootPayloadServiceId = "homelab-api/services/root-payload-service/RootPayloadService"

export interface RootPayloadServiceDef {
  /** Assembles the top-level MDM configuration profile from the provided payload entries. */
  rootPayload(
    payloadId: "Wifi" | "ACME" | "Certs" | "DNS",
    ...additionalPayloads: ReadonlyArray<Schemas.RootPayload.AllPayloads>
  ): Effect.Effect<Schemas.RootPayload.RootPayload>
}

export class RootPayloadService
  extends Context.Service<RootPayloadService, RootPayloadServiceDef>()(RootPayloadServiceId)
{
}
