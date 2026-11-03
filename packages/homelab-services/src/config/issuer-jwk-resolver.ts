import { Context, Effect, type Option } from "effect"
import type { JWTVerifyGetKey } from "jose"
import type { JWK } from "../schemas/OAuth.js"

export const IssuerJwkResolverId = "homelab-api/config/issuer-jwk-resolver-jose/IssuerJwkResolver"

export interface IssuerJwkResolverDef {
  /** Returns a jose-compatible `JWTVerifyGetKey` for the given issuer URL, or `None` if the issuer is unrecognized. */
  getJwkKeyVerifier(issuer: string): Option.Option<JWTVerifyGetKey>

  /** Returns the raw JWKs for the given issuer URL, or `None` if the issuer is unrecognized. */
  getJwkKeyPair(issuer: string): Option.Option<readonly [publicKey: JWK, privateKey: CryptoKey]>

  /** Checks if issuer has a public/private key pair */
  isLocalIssuer(issuer: string): boolean
}

export class IssuerJwkResolver
  extends Context.Service<IssuerJwkResolver, IssuerJwkResolverDef>()(IssuerJwkResolverId)
{}

/** {@inheritDoc IssuerJwkResolverDef.getJwkKeyVerifier} */
export function getJwkKeyVerifier(
  issuer: string,
): Effect.Effect<Option.Option<JWTVerifyGetKey>, never, IssuerJwkResolver> {
  return IssuerJwkResolver.pipe(Effect.map((_) => _.getJwkKeyVerifier(issuer)))
}

/** {@inheritDoc IssuerJwkResolverDef.getJwkKeyPair} */
export function getJwkKeyPair(issuer: string): Effect.Effect<
  Option.Option<
    readonly [
      publicKey: JWK,
      privateKey: CryptoKey,
    ]
  >,
  never,
  IssuerJwkResolver
> {
  return IssuerJwkResolver.pipe(Effect.map((_) => _.getJwkKeyPair(issuer)))
}

/** {@inheritDoc IssuerJwkResolverDef.isLocalIssuer} */
export function isLocalIssuer(issuer: string): Effect.Effect<
  boolean,
  never,
  IssuerJwkResolver
> {
  return IssuerJwkResolver.pipe(Effect.map((_) => _.isLocalIssuer(issuer)))
}
