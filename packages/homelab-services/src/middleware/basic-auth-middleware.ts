import { Context, type Option } from "effect"
import { HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"

export interface BasicAuthCredentialsDef {
  readonly apiKey: Option.Option<string>
  readonly dpopTokens: ReadonlyArray<string>
}

export class BasicAuthCredentials extends Context.Service<BasicAuthCredentials, BasicAuthCredentialsDef>()(
  "homelab-api/BasicAuthCredentials",
) {}

export class BasicAuthMiddleware extends HttpApiMiddleware.Service<BasicAuthMiddleware, {
  provides: BasicAuthCredentials
}>()("BasicAuthMiddleware", {
  security: {
    apiKey: HttpApiSecurity.apiKey({ in: "header", key: "Authorization" }),
  },
}) {}
