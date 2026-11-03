import { Context, DateTime, Effect, Layer } from "effect"
import type { Schemas } from "homelab-services"
import { Constants } from "homelab-shared"
import { exportJWK, generateKeyPair, SignJWT } from "jose"

export const DPoPProofBuilderServiceId = "homelab-services-node/test-utils/dpop/DPoPProofBuilderService"

export interface DPoPProofBuilderOptions {
  readonly htu: URL
  readonly htm: Schemas.HTTPMethod.HTTPMethod
  readonly nonce?: string
  readonly ath?: string
  readonly iat?: number
}

export interface DPoPProofBuilderServiceDef {
  readonly buildProof: (options: DPoPProofBuilderOptions) => Effect.Effect<string>
  readonly getPublicJWK: () => Effect.Effect<Record<string, unknown>>
}

export class DPoPProofBuilderService
  extends Context.Service<DPoPProofBuilderService, DPoPProofBuilderServiceDef>()(DPoPProofBuilderServiceId)
{
}

export const DPoPProofBuilderServiceLive = Layer.effect(
  DPoPProofBuilderService,
  Effect.gen(function*() {
    const { privateKey, publicKey } = yield* Effect.promise(() => generateKeyPair("ES256", { extractable: true }))

    const publicJwk = yield* Effect.promise(() => exportJWK(publicKey))

    return new DPoPProofBuilderServiceImpl(privateKey, {
      ...publicJwk,
      kty: "EC",
      alg: "ES256",
    })
  }),
)

export function buildProof(
  options: DPoPProofBuilderOptions,
): Effect.Effect<string, never, DPoPProofBuilderService> {
  return DPoPProofBuilderService.pipe(
    Effect.flatMap((_) => _.buildProof(options)),
  )
}

export function getPublicJWK(): Effect.Effect<Record<string, unknown>, never, DPoPProofBuilderService> {
  return DPoPProofBuilderService.pipe(
    Effect.flatMap((_) => _.getPublicJWK()),
  )
}

class DPoPProofBuilderServiceImpl implements DPoPProofBuilderServiceDef {
  constructor(
    private readonly privateKey: CryptoKey,
    private readonly publicJwk: Record<string, unknown>,
  ) {}

  buildProof(options: DPoPProofBuilderOptions) {
    return Effect.gen({ self: this }, function*() {
      const nowUnixS = options.iat ?? Math.floor(
        DateTime.toEpochMillis(yield* DateTime.now) / Constants.MS_PER_S,
      )

      const builder = new SignJWT({
        htm: options.htm,
        htu: options.htu.toString(),
        ...(options.nonce !== undefined ? { nonce: options.nonce } : undefined),
        ...(options.ath !== undefined ? { ath: options.ath } : undefined),
      })
        .setProtectedHeader({
          alg: "ES256",
          typ: "dpop+jwt",
          jwk: this.publicJwk,
        })
        .setIssuedAt(nowUnixS)
        .setJti(crypto.randomUUID())

      return yield* Effect.promise(() => builder.sign(this.privateKey))
    })
  }

  getPublicJWK() {
    return Effect.succeed({ ...this.publicJwk })
  }
}
