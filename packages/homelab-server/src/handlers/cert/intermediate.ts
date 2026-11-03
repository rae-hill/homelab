import { Effect } from "effect"
import { HttpEffect, HttpServerResponse } from "effect/http"
import type { Homelab } from "homelab-api"
import { Middleware, Services } from "homelab-services"

export const handleIntermediate = Effect.fn("handleIntermediate")(
  function*(args: Homelab.CertEndpoints.Intermediate.IntermediateCertHandlerArgs) {
    const identity = yield* Middleware.CurrentIdentity
    yield* Services.AuthorizationService.canView(identity, "Cert_Intermediate", args)

    const certService = yield* Services.CertificateService.CertificateService
    const cert = args.params.format === "der" ? certService.intermediateCert : certService.intermediateCrt
    const ext = args.params.format === "der" ? "der" : "crt"

    yield* HttpEffect.appendPreResponseHandler(
      (_, res) =>
        Effect.succeed(
          HttpServerResponse.setHeaders(res, {
            "Content-Disposition": `attachment; filename="homelab-wifi-cert-intermediate.${ext}"`,
          }),
        ),
    )

    return new Uint8Array(cert)
  },
)
