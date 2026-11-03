import { Effect } from "effect"
import { HttpEffect, HttpServerResponse } from "effect/http"
import type { Homelab } from "homelab-api"
import { Middleware, Services } from "homelab-services"
import { generateWifiProfile } from "./wifi.js"

export const handleWifiDownload = Effect.fn("handleWifiDownload")(
  function*(args: Homelab.MobileConfigEndpoints.WifiDownload.WifiMobileConfigDownloadHandlerArgs) {
    const identity = yield* Middleware.CurrentIdentity

    const wifiArgs: Homelab.MobileConfigEndpoints.Wifi.WifiMobileConfigHandlerArgs = {
      ...args,
      payload: args.query,
    } as any

    yield* Services.AuthorizationService.canView(identity, "Config_Wifi", wifiArgs)

    const response = yield* generateWifiProfile(wifiArgs)

    yield* HttpEffect.appendPreResponseHandler(
      (_, res) =>
        Effect.succeed(
          HttpServerResponse.setHeaders(res, {
            "Content-Disposition": `attachment; filename="${args.params.ssid}.mobileconfig"`,
          }),
        ),
    )

    return response
  },
)
