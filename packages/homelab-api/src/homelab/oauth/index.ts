import { HttpApiGroup } from "effect/http-api"
import * as ClaimCheck from "./claim-check.js"
import * as Token from "./token.js"

export const OAuthApi = HttpApiGroup.make("oauth")
  .add(Token.TokenEndpoint)
  .add(ClaimCheck.ClaimCheckEndpoint)

export * as ClaimCheck from "./claim-check.js"
export * as Token from "./token.js"
