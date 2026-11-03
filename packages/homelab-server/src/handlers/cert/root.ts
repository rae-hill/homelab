import { Effect } from "effect"
import { HttpEffect, HttpServerResponse } from "effect/http"
import type { Homelab } from "homelab-api"
import { Middleware, Services } from "homelab-services"

export const handleRoot = Effect.fn("handleRoot")(
  function*(args: Homelab.CertEndpoints.Root.RootCertHandlerArgs) {
    const identity = yield* Middleware.CurrentIdentity
    yield* Services.AuthorizationService.canView(identity, "Cert_Root", args)

    const certService = yield* Services.CertificateService.CertificateService
    const cert = args.params.format === "der" ? certService.rootCert : certService.rootCrt
    const ext = args.params.format === "der" ? "der" : "crt"

    yield* HttpEffect.appendPreResponseHandler(
      (_, res) =>
        Effect.succeed(
          HttpServerResponse.setHeaders(res, {
            "Content-Disposition": `attachment; filename="homelab-wifi-cert-root.${ext}"`,
          }),
        ),
    )

    return new Uint8Array(cert)
  },
)
