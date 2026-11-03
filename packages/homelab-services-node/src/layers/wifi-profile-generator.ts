import { Array as Arr, Effect, Layer, pipe, Schema } from "effect"
import { ApiErrors, Schemas, Services } from "homelab-services"

export const WifiProfileServiceLive = Layer.effect(
  Services.WifiProfileGeneratorService.WifiProfileService,
  Effect.gen(function*() {
    return new WifiProfileServiceImpl(
      yield* Services.CertConfigService.CertConfigService,
      yield* Services.CertificateService.CertificateService,
      yield* Services.RootPayloadService.RootPayloadService,
      yield* Services.WifiConfigService.WifiConfigService,
      yield* Services.AcmeConfigService.AcmeConfigService,
      yield* Services.EapClientConfigService.EapClientConfigService,
      yield* Services.EthernetConfigService.EthernetConfigService,
    )
  }),
)

class WifiProfileServiceImpl implements Services.WifiProfileGeneratorService.WifiProfileServiceDef {
  constructor(
    private readonly certConfigService: typeof Services.CertConfigService.CertConfigService.Service,
    private readonly certs: typeof Services.CertificateService.CertificateService.Service,
    private readonly rootPayloadService: typeof Services.RootPayloadService.RootPayloadService.Service,
    private readonly wifiConfigService: typeof Services.WifiConfigService.WifiConfigService.Service,
    private readonly acmeConfigService: typeof Services.AcmeConfigService.AcmeConfigService.Service,
    private readonly eapClientConfigService: typeof Services.EapClientConfigService.EapClientConfigService.Service,
    private readonly ethernetConfigService: typeof Services.EthernetConfigService.EthernetConfigService.Service,
  ) {}

  wpaPersonalWifi(
    ...wifiParams: Parameters<typeof Services.WifiConfigService.WifiConfigService.Service.wpaPersonalWifi>
  ): Effect.Effect<
    Schemas.RootPayload.RootPayloadWire,
    Services.WifiConfigService.WifiConfigGenerationError | ApiErrors.HttpApiEncodeError
  > {
    const certConfigService = this.certConfigService
    const certs = this.certs
    const rootPayloadService = this.rootPayloadService
    const wifiConfigService = this.wifiConfigService

    return Effect.gen(function*() {
      const rootCertPayload = yield* certConfigService.rootCert(
        "roots.crt",
        certs.rootCert,
      )

      const intermediatePayload = yield* certConfigService.intermediateCert(
        "intermediates.crt",
        certs.intermediateCert,
      )

      const wifiPayload = yield* wifiConfigService.wpaPersonalWifi(...wifiParams)

      return yield* pipe(
        rootPayloadService.rootPayload(
          "Wifi",
          rootCertPayload,
          intermediatePayload,
          wifiPayload,
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

  wpa3EnterprisePeapWifi(
    ...wifiParams: Parameters<typeof Services.WifiConfigService.WifiConfigService.Service.wpa3EnterprisePeapWifi>
  ): Effect.Effect<
    Schemas.RootPayload.RootPayloadWire,
    Services.WifiConfigService.WifiConfigGenerationError | ApiErrors.HttpApiEncodeError
  > {
    const [, username, password, , includeEthernetProfile] = wifiParams

    return Effect.gen({ self: this }, function*() {
      const rootCertPayload = yield* this.certConfigService.rootCert(
        "roots.crt",
        this.certs.rootCert,
      )

      const intermediatePayload = yield* this.certConfigService.intermediateCert(
        "intermediates.crt",
        this.certs.intermediateCert,
      )

      const wifiPayload = yield* this.wifiConfigService.wpa3EnterprisePeapWifi(...wifiParams)

      const ethernetPayloads = includeEthernetProfile
        ? yield* Effect.map(
          this.eapClientConfigService.peapConfig(username, password),
          (eapConfig) => this.ethernetConfigService.ethernetConfig(eapConfig),
        ).pipe(Effect.flatten, Effect.map(Arr.of))
        : []

      const payloads = Arr.appendAll(
        [rootCertPayload, intermediatePayload, wifiPayload],
        ethernetPayloads,
      )

      return yield* pipe(
        this.rootPayloadService.rootPayload(
          "Wifi",
          ...payloads,
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

  wpa3EnterpriseEAPTLSWifi(
    ...wifiParams: Parameters<typeof Services.WifiConfigService.WifiConfigService.Service.wpa3EnterpriseEAPTLSWifi>
  ): Effect.Effect<
    Schemas.RootPayload.RootPayloadWire,
    Services.WifiConfigService.WifiConfigGenerationError | ApiErrors.HttpApiEncodeError
  > {
    const [, serialNumber, , includeEthernetProfile] = wifiParams

    return Effect.gen({ self: this }, function*() {
      const rootCertPayload = yield* this.certConfigService.rootCert(
        "roots.crt",
        this.certs.rootCert,
      )

      const intermediatePayload = yield* this.certConfigService.intermediateCert(
        "intermediates.crt",
        this.certs.intermediateCert,
      )

      const acmePayload = yield* this.acmeConfigService.acmeConfig(
        serialNumber,
      )

      const wifiPayload = yield* this.wifiConfigService.wpa3EnterpriseEAPTLSWifi(...wifiParams)

      const ethernetPayloads = includeEthernetProfile
        ? yield* Effect.map(
          this.eapClientConfigService.eapTlsConfig(),
          (eapConfig) => this.ethernetConfigService.ethernetConfig(eapConfig),
        ).pipe(Effect.flatten, Effect.map(Arr.of))
        : []

      const payloads = Arr.appendAll(
        [rootCertPayload, intermediatePayload, wifiPayload, acmePayload],
        ethernetPayloads,
      )

      return yield* pipe(
        this.rootPayloadService.rootPayload(
          "Wifi",
          ...payloads,
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
