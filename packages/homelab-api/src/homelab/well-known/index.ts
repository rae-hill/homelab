import { HttpApiGroup } from "effect/http-api"
import * as OAuthAuthorizationServer from "./oauth-authorization-server.js"

export const WellKnownApi = HttpApiGroup.make("well-known")
  .add(OAuthAuthorizationServer.OAuthAuthorizationWellKnownEndpoint)

export * as OAuthAuthorizationServer from "./oauth-authorization-server.js"
