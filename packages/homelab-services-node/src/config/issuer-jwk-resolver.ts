import { Effect, FileSystem, flow, HashMap, Layer, Option, Redacted, Schema, Tuple } from "effect"
import { FetchHttpClient } from "effect/http"
import { Config, Schemas, StartupErrors, Utils } from "homelab-services"
import type { JWTVerifyGetKey } from "jose"
import { createLocalJWKSet, createRemoteJWKSet, customFetch, flattenedDecrypt, importJWK } from "jose"

export const IssuerJwkResolverLive = Layer.effect(
  Config.IssuerJwkResolver.IssuerJwkResolver,
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const origin = yield* Config.Env.originUrl
    const privateKeyPath = yield* Config.Env.tokenIssuerPrivateKeyPath
    const privateKeySecretPath = yield* Config.Env.tokenIssuerPrivateKeySecretFile
    const publicKeyPath = yield* Config.Env.tokenIssuerPublicKeyPath
    const remoteOIDCKanidm = yield* Config.OIDCConfigRemote.kanidm
    const fetch = yield* FetchHttpClient.Fetch

    const localPrivateJwkSecret = yield* privateKeySecretPath.pipe(
      Option.map(
        flow(
          fs.readFile,
          Effect.map(Utils.trimBufferNewlines),
          Effect.map(Redacted.make),
        ),
      ),
      Effect.transposeOption,
    )

    const localPrivateJwk = yield* privateKeyPath.pipe(
      Option.zipWith(localPrivateJwkSecret, Tuple.make),
      Option.map(
        ([privateKeyPath, jwkSecret]) =>
          fs.readFile(privateKeyPath).pipe(
            Effect.andThen(Schema.decodeEffect(Schemas.OAuth.JWEFromUint8Array)),
            Effect.andThen((localPrivateJwkEnrypted) =>
              Effect.tryPromise({
                try() {
                  return flattenedDecrypt(
                    localPrivateJwkEnrypted,
                    Redacted.value(jwkSecret),
                    {
                      keyManagementAlgorithms: ["PBES2-HS256+A128KW"],
                      maxPBES2Count: 1_000_000,
                    },
                  )
                },
                catch(error) {
                  return new StartupErrors.JWKPrivateKeyDecryptionError({ error })
                },
              })
            ),
            Effect.map((_) => _.plaintext),
            Effect.andThen(
              Schema.decodeEffect(Schemas.OAuth.JWKFromUint8Array),
            ),
            Effect.map(Redacted.make),
          ),
      ),
      Effect.transposeOption,
    )

    const localPublicJwk = yield* publicKeyPath.pipe(
      Option.map(
        flow(
          fs.readFile,
          Effect.andThen(
            Schema.decodeEffect(Schemas.OAuth.JWKFromUint8Array),
          ),
        ),
      ),
      Effect.transposeOption,
    )

    const localPrivateKey = yield* localPrivateJwk.pipe(
      Option.zipWith(localPublicJwk, Tuple.make),
      Option.map(
        ([localPrivateJwk, localPublicJwk]) =>
          Effect.tryPromise({
            try() {
              return importJWK(Utils.fixJwkForJose(Redacted.value(localPrivateJwk)), localPublicJwk.alg, {
                extractable: false,
              })
            },
            catch(error) {
              return new StartupErrors.JWKPrivateKeyImportError({
                error,
              })
            },
          }).pipe(
            Effect.filterOrFail(
              (key): key is CryptoKey => !(key instanceof Uint8Array),
              () => new globalThis.Error("Expected CryptoKey, got Uint8Array"),
            ),
            Effect.orDie,
          ),
      ),
      Effect.transposeOption,
    )

    const localKeysets: Array<readonly [string, JWTVerifyGetKey]> = localPublicJwk.pipe(
      Option.map(
        (localPublicJwk) => Tuple.make(origin.href, createLocalJWKSet({ keys: [Utils.fixJwkForJose(localPublicJwk)] })),
      ),
      Option.toArray,
    )

    const localKeypairs: Array<readonly [string, readonly [Schemas.OAuth.JWK, CryptoKey]]> = localPublicJwk
      .pipe(
        Option.zipWith(localPrivateKey, Tuple.make),
        Option.map((_) => Tuple.make(origin.href, _)),
        Option.toArray,
      )

    const remoteKeysets: typeof localKeysets = remoteOIDCKanidm.pipe(
      Option.map(
        ({ issuer, jwksUri }) => Tuple.make(issuer, createRemoteJWKSet(jwksUri, { [customFetch]: fetch })),
      ),
      Option.toArray,
    )

    return new IssuerJwkResolverImpl(
      HashMap.fromIterable([
        ...remoteKeysets,
        ...localKeysets,
      ]),
      HashMap.fromIterable([
        ...localKeypairs,
      ]),
    )
  }),
)

class IssuerJwkResolverImpl implements Config.IssuerJwkResolver.IssuerJwkResolverDef {
  constructor(
    private readonly jwkKeyMap: HashMap.HashMap<string, JWTVerifyGetKey>,
    private readonly jwkMap: HashMap.HashMap<
      string,
      readonly [publicKey: Schemas.OAuth.JWK, privateKey: CryptoKey]
    >,
  ) {}

  isLocalIssuer(issuer: string): boolean {
    return HashMap.has(this.jwkMap, issuer)
  }

  getJwkKeyVerifier(issuer: string): Option.Option<JWTVerifyGetKey> {
    return HashMap.get(this.jwkKeyMap, issuer)
  }

  getJwkKeyPair(issuer: string): Option.Option<readonly [publicKey: Schemas.OAuth.JWK, privateKey: CryptoKey]> {
    return HashMap.get(this.jwkMap, issuer)
  }
}
