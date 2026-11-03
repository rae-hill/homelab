import { Schema, Struct } from "effect"
import { OptionalUnixDateTime, UnixDateTime } from "./UnixDateTime.js"

import { Constants } from "homelab-shared"
import { Base64, Base64Url, OptionalBase64Url } from "./Base64.js"
import { StringFromUint8Array } from "./Buffer.js"
import * as Crypto from "./Crypto.js"
import { EnsureArray } from "./EnsureArray.js"
import { HTTPMethod } from "./HTTPMethod.js"
import { Optional, OptionalArray, OptionalString, OptionalUrl } from "./optionals.js"
import { ScopeGroupSetSchema } from "./scope-groups.js"

// ----------
// JWEs
// ----------

export const JWE = Schema.Struct({
  protected: Schema.String,
  encrypted_key: OptionalString,
  iv: OptionalString,
  ciphertext: Schema.String,
  tag: OptionalString,
})

export const JWEFromUint8Array = StringFromUint8Array.pipe(
  Schema.decodeTo(Schema.fromJsonString(JWE)),
)

// ----------
// JWKs
// ----------

export const KeyOp = Schema.Literals([
  "sign",
  "verify",
  "encrypt",
  "decrypt",
  "wrapKey",
  "unwrapKey",
  "deriveKey",
  "deriveBits",
])

export const KeyOps = Optional(EnsureArray(KeyOp))

export const KeyUse = Optional(Schema.Literals(["sig", "enc"]))

export const BaseJWK = Schema.Struct({
  use: KeyUse,
  kid: OptionalString,
  key_ops: KeyOps,
  x5u: OptionalUrl,
  x5c: OptionalArray(Base64),
  x5t: OptionalBase64Url,
  d: OptionalString,
})

export const ECJWK = BaseJWK.pipe(
  Schema.fieldsAssign(
    {
      kty: Schema.Literal("EC"),
      alg: Schema.Union([Crypto.ECDSAId, Crypto.PSSDSId]),
      crv: Crypto.EllipticCurveId,
      x: Base64Url,
      y: Base64Url,
    },
  ),
)

export const RSAJWK = BaseJWK.pipe(
  Schema.fieldsAssign(
    {
      kty: Schema.Literal("RSA"),
      alg: Schema.Union([Crypto.RSADSId, Crypto.PSSDSId]),
      mod: OptionalBase64Url,
      exp: OptionalBase64Url,
      dp: OptionalString,
      dq: OptionalString,
      p: OptionalString,
      q: OptionalString,
    },
  ),
)

export const OKPJWK = BaseJWK.pipe(
  Schema.fieldsAssign(
    {
      kty: Schema.Literal("OKP"),
      crv: Crypto.OKPCurveTypeId,
      x: Base64Url,
      alg: Schema.Literal("EdDSA"),
    },
  ),
)

export const JWK = Schema.Union([
  ECJWK,
  RSAJWK,
  OKPJWK,
])

export const OptionalJWK = Optional(JWK)

export type JWK = typeof JWK.Type

export const JWKFromUint8Array = StringFromUint8Array.pipe(
  Schema.decodeTo(Schema.fromJsonString(JWK)),
)

export const JWKs = Schema.Struct({
  keys: Schema.NonEmptyArray(JWK),
})

export type JWKs = typeof JWKs.Type

export const JWKsFromUint8Array = StringFromUint8Array.pipe(
  Schema.decodeTo(Schema.fromJsonString(JWKs)),
)

// ----------
// JWSs
// ----------

export const AsymmetricJWSAlg = Schema.Union([
  Crypto.RSADSId,
  Crypto.ECDSAId,
])

export const JWSAlgorithms = Schema.Union([
  ...AsymmetricJWSAlg.members,
  Crypto.HMACId,
  Schema.Literal("none"),
])

// ----------
// JWTs
// ----------

export const JWTString = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_\-.]+$/g)),
)

export const BaseJOSEHeader = Schema.Struct({
  alg: JWSAlgorithms,
  jwk: OptionalJWK,
  jku: OptionalUrl,
  kid: OptionalString,
  x5u: OptionalUrl,
  x5t: OptionalBase64Url,
})

export const DPoPJOSEHeader = BaseJOSEHeader
  .mapFields(Struct.omit(["alg", "jwk"]))
  .pipe(
    Schema.fieldsAssign(
      {
        alg: AsymmetricJWSAlg,
        typ: Schema.Literal("dpop+jwt"),
        jwk: JWK,
      },
    ),
  )

export const BaseJWT = Schema.Struct({
  iss: OptionalString,
  sub: OptionalString,
  aud: OptionalString,
  exp: OptionalUnixDateTime,
  iat: OptionalUnixDateTime,
  jti: OptionalString,
  nbf: OptionalUnixDateTime,
})

export const IdJWT = BaseJWT.pipe(
  Schema.fieldsAssign(
    {
      auth_time: OptionalUnixDateTime,
      nonce: OptionalString,
      amr: OptionalString,
      azp: OptionalString,
    },
  ),
)

export const DPoPProofJWT = BaseJWT
  .mapFields(Struct.omit(["jti", "iat"]))
  .pipe(
    Schema.fieldsAssign(
      {
        jti: Schema.String,
        htm: HTTPMethod,
        htu: Schema.URLFromString,
        iat: UnixDateTime,
        ath: OptionalBase64Url,
        nonce: OptionalString,
      },
    ),
  )

export const DPoPProofHTTPParams = DPoPProofJWT
  .mapFields(Struct.pick(["htm", "htu"]))

export const HomelabIdentityJWT = IdJWT.pipe(
  Schema.fieldsAssign(
    {
      [Constants.JWT_ROLES_KEY]: ScopeGroupSetSchema,
      email: Schema.String,
      preferred_username: Optional(Schema.String),
      name: Optional(Schema.String),
    },
  ),
)
