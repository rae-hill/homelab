import type { Option } from "effect"
import { Context, Effect } from "effect"
import type { AuthenticationError, BadRequest, InternalServerError } from "../errors/http-errors.js"
import { type Identity } from "../identity.js"
import type { HMACDigestError } from "./hmac-service.js"
import type { NonceValidationError } from "./nonce-service.js"

export const TokenIssuerServiceId = "homelab-api/services/token-issuer-service/TokenIssuerService"

export interface TokenIssueResult {
  /** The signed JWT access token. */
  readonly accessToken: string

  /** The server-generated nonce embedded in the token. */
  readonly nonce: string

  /** The identity belonging to the API key used in the request */
  readonly identity: Identity
}

export interface TokenIssuerServiceDef {
  /** Issues a DPoP-bound access token after validating the DPoP proof and API key.
   * The HTU and HTM are inferred from the DPoP proof itself. */
  readonly issueToken: (
    apiKey: Option.Option<string>,
    dpopTokens: ReadonlyArray<string>,
  ) => Effect.Effect<
    TokenIssueResult,
    AuthenticationError | BadRequest | InternalServerError | NonceValidationError | HMACDigestError
  >
}

export class TokenIssuerService
  extends Context.Service<TokenIssuerService, TokenIssuerServiceDef>()(TokenIssuerServiceId)
{
}

/** {@inheritDoc TokenIssuerServiceDef.issueToken} */
export function issueToken(
  ...params: Parameters<TokenIssuerServiceDef["issueToken"]>
): Effect.Effect<
  TokenIssueResult,
  AuthenticationError | BadRequest | InternalServerError | NonceValidationError | HMACDigestError,
  TokenIssuerService
> {
  return TokenIssuerService.pipe(
    Effect.flatMap(
      (_) => _.issueToken(...params),
    ),
  )
}
