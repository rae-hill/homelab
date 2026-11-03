import { Schema } from "effect"
import { IpAddress } from "./IpAddress.js"
import * as OAuthSchemas from "./OAuth.js"
import { Optional } from "./optionals.js"

export const AuthorizationHeader = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_\-. ]+$/g)),
)

export const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  token_type: Schema.Literal("DPoP"),
})

export const TokenHeaders = Schema.Struct({
  authorization: Optional(AuthorizationHeader),
  dpop: Optional(OAuthSchemas.JWTString),
  "x-forwarded-for": Optional(IpAddress),
})

export const AuthQueryParams = Schema.Struct({
  claim_check: Optional(Schema.String),
})
