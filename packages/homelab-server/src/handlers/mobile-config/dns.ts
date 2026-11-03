import { Effect, flow, Match, Option } from "effect"
import type { Homelab } from "homelab-api"
import { ApiErrors, Middleware, Services } from "homelab-services"
import { match } from "ts-pattern"

export const handleDns = Effect.fn("handleDns")(
  function*(args: Homelab.MobileConfigEndpoints.Dns.DnsHandlerArgs) {
    const identity = yield* Middleware.CurrentIdentity
    yield* Services.AuthorizationService.canView(identity, "Config_DNS", args)

    if (args.params.profile === "private_homelab_resolver_only" && !args.query.ssid) {
      return yield* new ApiErrors.BadRequest({
        message: "SSID is required for the resolver-only profile",
        reason: "dns-ssid-required",
      })
    }

    const name = args.query.name ?? identity.principle
    const ssid = Option.fromNullishOr(args.query.ssid)

    const dnsProfileGenerator = yield* Services.DnsProfileGeneratorService.DnsProfileService
    const xmlPrintingService = yield* Services.XmlPrintingService.XmlPrintingService

    const profile = yield* match(args.params.profile)
      .with("private_tailscale", () => dnsProfileGenerator.tailscalePrivate(name, ssid))
      .with("monitoring_tailscale", () => dnsProfileGenerator.tailscaleMonitor(name, ssid))
      .with("private_homelab", () => dnsProfileGenerator.homelabPrivate(name, ssid))
      .with(
        "private_homelab_resolver_only",
        () => dnsProfileGenerator.homelabPrivateResolverOnly(name, args.query.ssid!),
      )
      .exhaustive()

    return yield* xmlPrintingService.printXml(profile)
  },
  Effect.tapError(Effect.logError),
  Effect.mapError(
    flow(
      Match.value,
      Match.tag("XmlPrintingError", () =>
        new ApiErrors.InternalServerError({
          message: "Error creating PLIST XML",
        })),
      Match.orElse((_) => _),
    ),
  ),
)
