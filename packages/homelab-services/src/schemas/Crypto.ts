// https://www.rfc-editor.org/rfc/rfc7518.html#section-3.1
import { Schema } from "effect"

export const HMACId = Schema.Literals([
  "HS256",
  "HS384",
  "HS512",
])

export const RSADSId = Schema.Literals([
  "RS256",
  "RS384",
  "RS512",
])

export const ECDSAId = Schema.Literals([
  "ES256",
  "ES384",
  "ES512",
])

export const PSSDSId = Schema.Literals([
  "PS256",
  "PS384",
  "PS512",
])

export const EllipticCurveId = Schema.Literals([
  "P-256",
  "P-384",
  "P-521",
])

export const OKPCurveTypeId = Schema.Literals([
  "Ed25519",
  "Ed448",
  "X25519",
  "X448",
])
