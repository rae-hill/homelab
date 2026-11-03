import { Schema } from "effect"

import * as OAuth from "./OAuth.js"

export const OAuthAuthorizationServerWellKnown = Schema.Struct({
  issuer: Schema.URLFromString,
  token_endpoint: Schema.URLFromString,
  token_endpoint_auth_methods_supported: Schema.NonEmptyArray(Schema.Literal("client_secret_basic")),
  grant_types_supported: Schema.NonEmptyArray(Schema.Literal("client_credentials")),
  dpop_signing_alg_values_supported: Schema.NonEmptyArray(OAuth.AsymmetricJWSAlg),
  response_types_supported: Schema.Tuple([]),
})
