import { Effect, Layer, pipe, Schema } from "effect"
import { ApiErrors, Schemas, Services } from "homelab-services"

export const AcmeProfileServiceLive = Layer.effect(
  Services.AcmeProfileGeneratorService.AcmeProfileService,
  Effect.gen(function*() {
    return new AcmeProfileServiceImpl(
      yield* Services.AcmeConfigService.AcmeConfigService,
      yield* Services.CertConfigService.CertConfigService,
      yield* Services.CertificateService.CertificateService,
      yield* Services.RootPayloadService.RootPayloadService,
    )
  }),
)

class AcmeProfileServiceImpl implements Services.AcmeProfileGeneratorService.AcmeProfileServiceDef {
  constructor(
    private readonly acmeConfigService: typeof Services.AcmeConfigService.AcmeConfigService.Service,
    private readonly certConfigService: typeof Services.CertConfigService.CertConfigService.Service,
    private readonly certs: typeof Services.CertificateService.CertificateService.Service,
    private readonly rootPayloadService: typeof Services.RootPayloadService.RootPayloadService.Service,
  ) {}

  acmeProfile(
    ...acmeParams: Parameters<typeof Services.AcmeConfigService.AcmeConfigService.Service.acmeConfig>
  ): Effect.Effect<Schemas.RootPayload.RootPayloadWire, ApiErrors.HttpApiEncodeError> {
    const acmeConfigService = this.acmeConfigService
    const certConfigService = this.certConfigService
    const certs = this.certs
    const rootPayloadService = this.rootPayloadService

    return Effect.gen(function*() {
      const rootCertPayload = yield* certConfigService.rootCert(
        "roots.crt",
        certs.rootCert,
      )

      const acmePayload = yield* acmeConfigService.acmeConfig(...acmeParams)

      return yield* pipe(
        rootPayloadService.rootPayload(
          "ACME",
          rootCertPayload,
          acmePayload,
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
