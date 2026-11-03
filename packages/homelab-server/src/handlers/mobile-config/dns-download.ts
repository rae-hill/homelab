import { Effect } from "effect"
import { HttpEffect, HttpServerResponse } from "effect/http"
import type { Homelab } from "homelab-api"
import { handleDns } from "./dns.js"

export const handleDnsDownload = Effect.fn("handleDnsDownload")(
  function*(args: Homelab.MobileConfigEndpoints.DnsDownload.DnsDownloadHandlerArgs) {
    const response = yield* handleDns({ ...args, headers: args.headers } as any)

    yield* HttpEffect.appendPreResponseHandler(
      (_, res) =>
        Effect.succeed(
          HttpServerResponse.setHeaders(res, {
            "Content-Disposition": `attachment; filename="dns-${args.params.profile}.mobileconfig"`,
          }),
        ),
    )

    return response
  },
)
