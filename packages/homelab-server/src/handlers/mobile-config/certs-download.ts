import { Effect } from "effect"
import { HttpEffect, HttpServerResponse } from "effect/http"
import type { Homelab } from "homelab-api"
import { handleCerts } from "./certs.js"

export const handleCertsDownload = Effect.fn("handleCertsDownload")(
  function*(args: Homelab.MobileConfigEndpoints.CertsDownload.CertsDownloadHandlerArgs) {
    const response = yield* handleCerts({ ...args, headers: args.headers } as any)

    yield* HttpEffect.appendPreResponseHandler(
      (_, res) =>
        Effect.succeed(
          HttpServerResponse.setHeaders(res, {
            "Content-Disposition": `attachment; filename="certs.mobileconfig"`,
          }),
        ),
    )

    return response
  },
)
