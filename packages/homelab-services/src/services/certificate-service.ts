import { Context, Data } from "effect"
import type { PlatformError } from "effect/PlatformError"

export const CertificateServiceId = "homelab-api/services/certificate-service/CertificateService"

export class CertificateReadError extends Data.TaggedError("CertificateReadError")<
  {
    readonly error: PlatformError
  }
> {}

export interface CertificateServiceDef {
  /** The DER-encoded root CA certificate loaded from disk. */
  readonly rootCert: Buffer

  /** The DER-encoded intermediate CA certificate loaded from disk. */
  readonly intermediateCert: Buffer

  /** The PEM-encoded (CRT) root CA certificate loaded from disk. */
  readonly rootCrt: Buffer

  /** The PEM-encoded (CRT) intermediate CA certificate loaded from disk. */
  readonly intermediateCrt: Buffer
}

export class CertificateService
  extends Context.Service<CertificateService, CertificateServiceDef>()(CertificateServiceId)
{
}
