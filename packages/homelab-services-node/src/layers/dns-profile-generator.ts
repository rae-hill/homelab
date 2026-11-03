import type { Option } from "effect"
import { Effect, Layer, pipe, Schema } from "effect"
import { ApiErrors, Schemas, Services } from "homelab-services"

export const DnsProfileServiceLive = Layer.effect(
  Services.DnsProfileGeneratorService.DnsProfileService,
  Effect.gen(function*() {
    return new DnsProfileServiceImpl(
      yield* Services.DnsConfigService.DnsConfigService,
      yield* Services.RootPayloadService.RootPayloadService,
    )
  }),
)

class DnsProfileServiceImpl implements Services.DnsProfileGeneratorService.DnsProfileServiceDef {
  constructor(
    private readonly dnsConfigService: typeof Services.DnsConfigService.DnsConfigService.Service,
    private readonly rootPayloadService: typeof Services.RootPayloadService.RootPayloadService.Service,
  ) {}

  tailscalePrivate(name: string, ssid: Option.Option<string>) {
    return this.buildProfile(this.dnsConfigService.tailscalePrivate(name, ssid))
  }

  tailscaleMonitor(name: string, ssid: Option.Option<string>) {
    return this.buildProfile(this.dnsConfigService.tailscaleMonitor(name, ssid))
  }

  homelabPrivate(name: string, ssid: Option.Option<string>) {
    return this.buildProfile(this.dnsConfigService.homelabPrivate(name, ssid))
  }

  homelabPrivateResolverOnly(name: string, ssid: string) {
    return this.buildProfile(this.dnsConfigService.homelabPrivateResolverOnly(name, ssid))
  }

  private buildProfile(configEffect: Effect.Effect<Schemas.DnsConfig.DNSConfig>) {
    const rootPayloadService = this.rootPayloadService

    return Effect.gen(function*() {
      const dnsConfig = yield* configEffect

      return yield* pipe(
        rootPayloadService.rootPayload("DNS", dnsConfig),
        Effect.andThen(Schema.encodeEffect(Schemas.RootPayload.RootPayloadSchema)),
        Effect.catchTag("SchemaError", ApiErrors.HttpApiEncodeError.fromSchemaError),
      )
    })
  }
}
