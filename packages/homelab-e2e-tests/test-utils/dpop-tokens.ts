import { Context, DateTime, Effect, Layer, Schema } from "effect"
import type { Schemas } from "homelab-services"
import type { JWK } from "jose"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import * as nodeCrypto from "node:crypto"

export { buildProof, DPoPProofBuilderService, DPoPProofBuilderServiceLive } from "homelab-services-node/test-utils"

export const DPoPTokenCreatorServiceId = "homelab-e2e-tests/test-utils/DPoPTokenCreatorService"

export class DpopTokenCreationError extends Schema.TaggedError<DpopTokenCreationError>()(
  "DpopTokenCreationError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export interface CreateDPoPTokenOptions {
  readonly htu: URL
  readonly htm: Schemas.HTTPMethod.HTTPMethod
  readonly nonce?: string
  readonly ath?: string
  readonly accessToken?: string
  readonly iat?: number
}

export interface DPoPTokenCreatorServiceDef {
  /** Creates a DPoP proof JWT signed with an ephemeral ES384 key pair. */
  readonly createToken: (options: CreateDPoPTokenOptions) => Effect.Effect<string, DpopTokenCreationError>
  /** Returns the public JWK for the ephemeral key pair, e.g. to register with the auth server. */
  readonly getPublicJWK: () => Effect.Effect<Record<string, unknown>>
}

export class DPoPTokenCreatorService
  extends Context.Service<DPoPTokenCreatorService, DPoPTokenCreatorServiceDef>()(DPoPTokenCreatorServiceId)
{
}

export const DPoPTokenCreatorServiceLive = Layer.effect(
  DPoPTokenCreatorService,
  Effect.gen(function*() {
    const keyPair = yield* Effect.tryPromise({
      try: () =>
        nodeCrypto.webcrypto.subtle.generateKey(
          { name: "ECDSA", namedCurve: "P-384" },
          true,
          ["sign", "verify"],
        ),
      catch: (cause) => new DpopTokenCreationError({ message: "Failed to generate DPoP key pair", cause }),
    })

    const publicJwk = yield* Effect.tryPromise({
      try: () => exportJWK(keyPair.publicKey),
      catch: (cause) => new DpopTokenCreationError({ message: "Failed to export public JWK", cause }),
    })

    return new DPoPTokenCreatorServiceImpl(
      keyPair.privateKey,
      { ...publicJwk, alg: "ES384" },
    )
  }),
)

export function createToken(
  options: CreateDPoPTokenOptions,
): Effect.Effect<string, DpopTokenCreationError, DPoPTokenCreatorService> {
  return DPoPTokenCreatorService.pipe(
    Effect.flatMap((_) => _.createToken(options)),
  )
}

export function getPublicJWK(): Effect.Effect<Record<string, unknown>, never, DPoPTokenCreatorService> {
  return DPoPTokenCreatorService.pipe(
    Effect.flatMap((_) => _.getPublicJWK()),
  )
}

class DPoPTokenCreatorServiceImpl implements DPoPTokenCreatorServiceDef {
  constructor(
    private readonly privateKey: nodeCrypto.webcrypto.CryptoKey,
    private readonly publicJwk: JWK,
  ) {}

  createToken(options: CreateDPoPTokenOptions) {
    return Effect.gen({ self: this }, function*() {
      const ath = options.ath ?? (options.accessToken !== undefined
        ? nodeCrypto.createHash("sha256").update(options.accessToken, "ascii").digest("base64url")
        : undefined)

      const nowUnix = options.iat ?? (yield* DateTime.nowAsDate)

      const builder = new SignJWT({
        htm: options.htm,
        htu: options.htu.toString(),
        ...(options.nonce !== undefined ? { nonce: options.nonce } : undefined),
        ...(ath !== undefined ? { ath } : undefined),
      })
        .setProtectedHeader({
          alg: "ES384",
          typ: "dpop+jwt",
          jwk: this.publicJwk,
        })
        .setIssuedAt(nowUnix)
        .setJti(nodeCrypto.randomUUID())

      return yield* Effect.tryPromise({
        try: () => builder.sign(this.privateKey),
        catch: (cause) => new DpopTokenCreationError({ message: "Failed to sign DPoP token", cause }),
      })
    })
  }

  getPublicJWK() {
    return Effect.succeed({ ...this.publicJwk })
  }
}

export class TestTokenError extends Schema.TaggedError<TestTokenError>()(
  "TestTokenError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export const makeTestJwt = (claims: Record<string, unknown>): Effect.Effect<string, TestTokenError> =>
  Effect.tryPromise({
    try: async () => {
      const { privateKey } = await generateKeyPair("ES256", { extractable: true })
      return new SignJWT(claims).setProtectedHeader({ alg: "ES256" }).setIssuedAt().sign(privateKey)
    },
    catch: (cause) => new TestTokenError({ message: "Failed to create test JWT", cause }),
  })

export const makeTestDPoPWithWrongSignature = (
  htu: URL,
  htm: "GET" | "PUT" | "POST",
): Effect.Effect<string, TestTokenError> =>
  Effect.tryPromise({
    try: async () => {
      const { privateKey: signingKey } = await generateKeyPair("ES256", { extractable: true })
      const { publicKey: mismatchedPublicKey } = await generateKeyPair("ES256", { extractable: true })
      const mismatchedJwk = await exportJWK(mismatchedPublicKey)

      return new SignJWT({ htm, htu: htu.toString() })
        .setProtectedHeader({
          alg: "ES256",
          typ: "dpop+jwt",
          jwk: {
            kty: mismatchedJwk.kty,
            crv: mismatchedJwk.crv,
            x: mismatchedJwk.x,
            y: mismatchedJwk.y,
          } as Pick<JWK, "kty" | "crv" | "x" | "y" | "e" | "n">,
        })
        .setIssuedAt()
        .setJti(crypto.randomUUID())
        .sign(signingKey)
    },
    catch: (cause) => new TestTokenError({ message: "Failed to create DPoP with mismatched signature", cause }),
  })

export const makeTestDPoPWithoutJwk = (
  htu: URL,
  htm: "GET" | "PUT" | "POST",
): Effect.Effect<string, TestTokenError> =>
  Effect.tryPromise({
    try: async () => {
      const { privateKey } = await generateKeyPair("ES256", { extractable: true })
      return new SignJWT({ htm, htu: htu.toString() })
        .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt" })
        .setIssuedAt()
        .setJti(crypto.randomUUID())
        .sign(privateKey)
    },
    catch: (cause) => new TestTokenError({ message: "Failed to create DPoP without JWK", cause }),
  })
