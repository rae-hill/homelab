import { Layer } from "effect"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Homelab } from "homelab-api"
import { CertApiLive } from "./handlers/cert/index.js"
import { MobileConfigApiLive } from "./handlers/mobile-config/index.js"
import { OAuthApiLive } from "./handlers/oauth/index.js"
import { StatusApiLive } from "./handlers/status/index.js"
import { WellKnownApiLive } from "./handlers/well-known/index.js"
import { AuthMiddlewareLive, BasicAuthMiddlewareLive } from "./middleware/index.js"

export const ApiLive = HttpApiBuilder.layer(Homelab.HomelabApi, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide(CertApiLive),
  Layer.provide(MobileConfigApiLive),
  Layer.provide(OAuthApiLive),
  Layer.provide(StatusApiLive),
  Layer.provide(WellKnownApiLive),
  Layer.provide(AuthMiddlewareLive),
  Layer.provide(BasicAuthMiddlewareLive),
  Layer.provide(HttpRouter.cors()),
)
