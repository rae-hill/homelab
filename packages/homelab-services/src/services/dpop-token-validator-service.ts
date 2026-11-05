import { Context, Effect } from "effect"
import type { AuthenticationError, BadRequest, InternalServerError } from "../errors/http-errors.js"
import type { HTTPMethod } from "../schemas/HTTPMethod.js"
import type * as OAuth from "../schemas/OAuth.js"
import type { HMACDigestError } from "./hmac-service.js"
import type { NonceValidationError } from "./nonce-service.js"

export const DPoPTokenValidatorServiceId = "homelab-api/services/dpop-token-validator-service/DPoPTokenValidatorService"

export interface DPoPValidationResult {
  /** The parsed DPoP JOSE header from the validated proof. */
  readonly headers: typeof OAuth.DPoPJOSEHeader.Type

  /** The parsed DPoP proof JWT claims. */
  readonly token: typeof OAuth.DPoPProofJWT.Type

  /** The raw DPoP proof JWT string. */
  readonly raw: string
}

export interface DPoPTokenValidatorServiceDef {
  /** Validates a DPoP proof token, checking the binding, HTU/HTM claims, optionally the nonce, and hash of the access token (ath, SHA256). */
  readonly validateDPoPToken: (
    expectedHtu: URL,
    expectedHtm: HTTPMethod,
    dpopTokens: ReadonlyArray<string>,
    accessToken?: string,
    requireNonce?: boolean,
  ) => Effect.Effect<
    DPoPValidationResult,
    AuthenticationError | BadRequest | InternalServerError
  >
}

export class DPoPTokenValidatorService
  extends Context.Service<DPoPTokenValidatorService, DPoPTokenValidatorServiceDef>()(DPoPTokenValidatorServiceId)
{
}

/** {@inheritDoc DPoPTokenValidatorServiceDef.validateDPoPToken} */
export const validateDPoPToken = Effect.fn("DPoPTokenValidatorService.validateDPoPToken")(function*(
  ...params: Parameters<DPoPTokenValidatorServiceDef["validateDPoPToken"]>
): Effect.fn.Return<
  DPoPValidationResult,
  AuthenticationError | BadRequest | NonceValidationError | HMACDigestError | InternalServerError,
  DPoPTokenValidatorService
> {
  const svc = yield* DPoPTokenValidatorService
  return yield* svc.validateDPoPToken(...params)
})
