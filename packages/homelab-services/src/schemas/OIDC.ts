import { Schema } from "effect"
import { StringFromUint8Array } from "./Buffer.js"

export const OIDCWellKnownWire = Schema.Struct({
  issuer: Schema.String,
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  userinfo_endpoint: Schema.String,
  jwks_uri: Schema.URLFromString,
  revocation_endpoint: Schema.URLFromString,
  introspection_endpoint: Schema.URLFromString,
})

const OIDCWellKnownStruct = Schema.Struct({
  issuer: Schema.String,
  authorizationEndpoint: Schema.String,
  tokenEndpoint: Schema.String,
  userInfoEndpoint: Schema.String,
  jwksUri: Schema.URLFromString,
  revocationEndpoint: Schema.URLFromString,
  introspectionEndpoint: Schema.URLFromString,
})

/**
 * Decoded type uses camelCase keys; the wire (encoded) form uses the
 * snake_case keys from the OIDC discovery document.
 */
export const OIDCWellKnown = OIDCWellKnownStruct.pipe(
  Schema.encodeKeys({
    authorizationEndpoint: "authorization_endpoint",
    tokenEndpoint: "token_endpoint",
    userInfoEndpoint: "userinfo_endpoint",
    jwksUri: "jwks_uri",
    revocationEndpoint: "revocation_endpoint",
    introspectionEndpoint: "introspection_endpoint",
  }),
)

export type OIDCWellKnown = typeof OIDCWellKnown.Type

export const OIDCWellKnownFromUint8Array = StringFromUint8Array.pipe(
  Schema.decodeTo(Schema.fromJsonString(OIDCWellKnown)),
)
