import { Effect, FileSystem, Layer } from "effect"
import { Config, Services } from "homelab-services"

export const CertificateServiceLive = Layer.effect(
  Services.CertificateService.CertificateService,
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const rootCertPath = yield* Config.Env.rootCertDerPath
    const intermediateCertPath = yield* Config.Env.intermediateCertDerPath
    const rootCrtPath = yield* Config.Env.rootCertCrtPath
    const intermediateCrtPath = yield* Config.Env.intermediateCertCrtPath

    const readCert = (path: string) =>
      fs.readFile(path).pipe(
        Effect.mapBoth({
          onFailure: (error) => new Services.CertificateService.CertificateReadError({ error }),
          onSuccess: (result) => Buffer.from(result),
        }),
      )

    const rootCert = yield* readCert(rootCertPath)
    const intermediateCert = yield* readCert(intermediateCertPath)
    const rootCrt = yield* readCert(rootCrtPath)
    const intermediateCrt = yield* readCert(intermediateCrtPath)

    return { rootCert, intermediateCert, rootCrt, intermediateCrt }
  }),
)
