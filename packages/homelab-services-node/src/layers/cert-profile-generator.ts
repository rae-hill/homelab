import { Effect, Layer, pipe, Schema } from "effect"
import { ApiErrors, Schemas, Services } from "homelab-services"

export const CertProfileServiceLive = Layer.effect(
  Services.CertProfileGeneratorService.CertProfileService,
  Effect.gen(function*() {
    return new CertProfileServiceImpl(
      yield* Services.CertConfigService.CertConfigService,
      yield* Services.CertificateService.CertificateService,
      yield* Services.RootPayloadService.RootPayloadService,
    )
  }),
)

class CertProfileServiceImpl implements Services.CertProfileGeneratorService.CertProfileServiceDef {
  constructor(
    private readonly certConfigService: typeof Services.CertConfigService.CertConfigService.Service,
    private readonly certs: typeof Services.CertificateService.CertificateService.Service,
    private readonly rootPayloadService: typeof Services.RootPayloadService.RootPayloadService.Service,
  ) {}

  get certProfile(): Effect.Effect<Schemas.RootPayload.RootPayloadWire, ApiErrors.HttpApiEncodeError> {
    const certConfigService = this.certConfigService
    const certs = this.certs
    const rootPayloadService = this.rootPayloadService

    return Effect.gen(function*() {
      const rootCertPayload = yield* certConfigService.rootCert(
        "roots.crt",
        certs.rootCert,
      )

      const intermediatePayload = yield* certConfigService.intermediateCert(
        "intermediates.crt",
        certs.intermediateCert,
      )

      return yield* pipe(
        rootPayloadService.rootPayload(
          "Certs",
          rootCertPayload,
          intermediatePayload,
        ),
        Effect.andThen(
          Schema.encodeEffect(
            Schemas.RootPayload.RootPayloadSchema,
          ),
        ),
        Effect.catchTag(
          "SchemaError",
          ApiErrors.HttpApiEncodeError.fromSchemaError,
        ),
      )
    })
  }
}
