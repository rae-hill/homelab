import { Effect } from "effect"
import { HttpEffect, HttpServerResponse } from "effect/http"
import type { Homelab } from "homelab-api"
import { Middleware, Services } from "homelab-services"

export const handleCombined = Effect.fn("handleCombined")(
  function*(args: Homelab.CertEndpoints.Combined.CombinedCertHandlerArgs) {
    const identity = yield* Middleware.CurrentIdentity
    yield* Services.AuthorizationService.canView(identity, "Cert_Combined", args)

    const certService = yield* Services.CertificateService.CertificateService
    const combined = Buffer.concat([certService.rootCrt, Buffer.from("\n"), certService.intermediateCrt])

    yield* HttpEffect.appendPreResponseHandler(
      (_, res) =>
        Effect.succeed(
          HttpServerResponse.setHeaders(res, {
            "Content-Disposition": `attachment; filename="homelab-wifi-cert-combined.pem"`,
          }),
        ),
    )

    return new Uint8Array(combined)
  },
)
