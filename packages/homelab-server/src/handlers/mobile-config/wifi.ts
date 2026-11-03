import { Effect, flow, Match, Option } from "effect"
import type { Homelab } from "homelab-api"
import { ApiErrors, Config, Middleware, Operation, Services } from "homelab-services"
import { match, P } from "ts-pattern"

export const generateWifiProfile = Effect.fn("generateWifiProfile")(
  function*(args: Homelab.MobileConfigEndpoints.Wifi.WifiMobileConfigHandlerArgs) {
    const profile = yield* match(args)
      .with(
        {
          params: {
            ssid: P.select("ssid"),
          },
          payload: {
            enterpriseClientType: "EAP-TLS",
            disableMACRandomization: P.select("disableMACRandomization"),
            includeEthernetProfile: P.select("includeEthernetProfile"),
          },
        },
        ({ disableMACRandomization, includeEthernetProfile, ssid }) =>
          Effect.gen(function*() {
            const maybeSerialNumber = yield* Option.fromNullishOr(args.headers["x-forwarded-for"]).pipe(
              Option.match({
                onNone: () => Effect.succeed(Option.none<string>()),
                onSome: (ip) => Config.SerialNumberConfig.resolveIp(ip),
              }),
            )

            const serialNumber = yield* Effect.fromOption(
              maybeSerialNumber,
              () =>
                new ApiErrors.AuthorizationError({
                  resource: "Config_Wifi",
                  operation: Operation.create,
                  message: "Attempting to create EAP-TLS payload from an unrecognized IP address",
                }),
            )

            return yield* Services.WifiProfileGeneratorService.wpa3EnterpriseEAPTLSWifi(
              ssid,
              serialNumber,
              disableMACRandomization,
              includeEthernetProfile,
            )
          }),
      )
      .with(
        {
          payload: {
            enterpriseClientType: "PEAP",
          },
        },
        ({ params: { ssid }, payload: { disableMACRandomization, includeEthernetProfile, password, username } }) =>
          Services.WifiProfileGeneratorService.wpa3EnterprisePeapWifi(
            ssid,
            username,
            password,
            disableMACRandomization,
            includeEthernetProfile,
          ),
      )
      .otherwise(({ params: { encryption, ssid }, payload }) => {
        const password = "password" in payload ? payload.password : ""

        return Services.WifiProfileGeneratorService.wpaPersonalWifi(
          encryption,
          ssid,
          password,
          payload.disableMACRandomization,
        )
      })

    return yield* Services.XmlPrintingService.printXml(
      profile,
    )
  },
  Effect.tapError(Effect.logError),
  Effect.mapError(
    flow(
      Match.value,
      Match.tag("XmlPrintingError", () =>
        new ApiErrors.InternalServerError({
          message: "Error creating PLIST XML",
        })),
      Match.tag(
        "WifiConfigGenerationError",
        (err) => {
          switch (err.reason) {
            case "ssid-not-found":
              return new ApiErrors.NotFound({
                reason: err.reason,
                message: err.error,
              })
            default:
              return new ApiErrors.InternalServerError({
                message: "An unknown error has occured",
              })
          }
        },
      ),
      Match.orElse((_) => _),
    ),
  ),
)

export const handleWifi = Effect.fn("handleWifi")(
  function*(args: Homelab.MobileConfigEndpoints.Wifi.WifiMobileConfigHandlerArgs) {
    const identity = yield* Middleware.CurrentIdentity
    yield* Services.AuthorizationService.canCreate(identity, "Config_Wifi", args)

    return yield* generateWifiProfile(args)
  },
  Effect.tapError(Effect.logError),
)
