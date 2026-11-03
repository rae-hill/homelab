import { Context, Effect, type Option } from "effect"
import type { FeatureFlagsSet } from "../schemas/feature-flags.js"

export interface EnvDef {
  /** The public-facing origin URL of the homelab server. */
  readonly originUrl: URL

  /** Filesystem path to the private key file used for signing issued tokens. */
  readonly tokenIssuerPrivateKeyPath: Option.Option<string>

  /** File containing the secret key to decrypt the private key file with */
  readonly tokenIssuerPrivateKeySecretFile: Option.Option<string>

  /** File containing the public JWK for the token issuer */
  readonly tokenIssuerPublicKeyPath: Option.Option<string>

  /** Filesystem path to the HMAC shared secret file. */
  readonly hmacSecretFilePath: Option.Option<string>

  /** The set of enabled feature flags for this deployment. */
  readonly featureFlags: FeatureFlagsSet

  /** OIDC well-known discovery URL for the Kanidm identity provider. */
  readonly kanidmOidcUrl: URL

  /** Base URL of the internal certificate authority. */
  readonly caUrl: URL

  /**
   * Path segment appended to `caUrl` to form the ACME directory URL.
   * @remarks Defaults to `/acme/acme/directory`.
   */
  readonly acmeDirectoryPath: string

  /**
   * Whether ACME certificates should be hardware-bound.
   * @remarks Defaults to `true`.
   */
  readonly hardwareBound: boolean

  /**
   * The key type used for ACME certificate generation.
   * @remarks Defaults to `"ECSECPrimeRandom"`.
   */
  readonly keyType: string

  /**
   * The key size in bits for ACME certificate generation.
   * @remarks Defaults to `384`.
   */
  readonly keySize: number

  /** Filesystem path to the API keys file. */
  readonly apiKeysFilePath: string

  /** Absolute filesystem path to the root CA certificate in DER format. */
  readonly rootCertDerPath: string

  /** Absolute filesystem path to the intermediate CA certificate in DER format. */
  readonly intermediateCertDerPath: string

  /** Absolute filesystem path to the root CA certificate in CRT (PEM) format. */
  readonly rootCertCrtPath: string

  /** Absolute filesystem path to the intermediate CA certificate in CRT (PEM) format. */
  readonly intermediateCertCrtPath: string

  /** Filesystem path to the serial numbers JSON file. */
  readonly serialNumbersFile: Option.Option<string>
}

export class Env extends Context.Service<Env, EnvDef>()("homelab-api/config/env/Env") {}

/** {@inheritDoc EnvDef.originUrl} */
export const originUrl = Env.pipe(Effect.map((_) => _.originUrl))

/** {@inheritDoc EnvDef.tokenIssuerPrivateKeyPath} */
export const tokenIssuerPrivateKeyPath = Env.pipe(Effect.map((_) => _.tokenIssuerPrivateKeyPath))

/** {@inheritDoc EnvDef.tokenIssuerPrivateKeySecretFile} */
export const tokenIssuerPrivateKeySecretFile = Env.pipe(Effect.map((_) => _.tokenIssuerPrivateKeySecretFile))

/** {@inheritDoc EnvDef.tokenIssuerPublicKeyPath} */
export const tokenIssuerPublicKeyPath = Env.pipe(Effect.map((_) => _.tokenIssuerPublicKeyPath))

/** {@inheritDoc EnvDef.hmacSecretFilePath} */
export const hmacSecretFilePath = Env.pipe(Effect.map((_) => _.hmacSecretFilePath))

/** {@inheritDoc EnvDef.featureFlags} */
export const featureFlags = Env.pipe(Effect.map((_) => _.featureFlags))

/** {@inheritDoc EnvDef.kanidmOidcUrl} */
export const kanidmOidcUrl = Env.pipe(Effect.map((_) => _.kanidmOidcUrl))

/** {@inheritDoc EnvDef.caUrl} */
export const caUrl = Env.pipe(Effect.map((_) => _.caUrl))

/** {@inheritDoc EnvDef.acmeDirectoryPath} */
export const acmeDirectoryPath = Env.pipe(Effect.map((_) => _.acmeDirectoryPath))

/** The full ACME directory URL, derived from `caUrl` and `acmeDirectoryPath`. */
export const acmeUrl = Env.pipe(Effect.map((_) => new URL(_.acmeDirectoryPath, _.caUrl)))

/** {@inheritDoc EnvDef.hardwareBound} */
export const hardwareBound = Env.pipe(Effect.map((_) => _.hardwareBound))

/** {@inheritDoc EnvDef.keyType} */
export const keyType = Env.pipe(Effect.map((_) => _.keyType))

/** {@inheritDoc EnvDef.keySize} */
export const keySize = Env.pipe(Effect.map((_) => _.keySize))

/** {@inheritDoc EnvDef.apiKeysFilePath} */
export const apiKeysFilePath = Env.pipe(Effect.map((_) => _.apiKeysFilePath))

/** {@inheritDoc EnvDef.rootCertDerPath} */
export const rootCertDerPath = Env.pipe(Effect.map((_) => _.rootCertDerPath))

/** {@inheritDoc EnvDef.intermediateCertDerPath} */
export const intermediateCertDerPath = Env.pipe(Effect.map((_) => _.intermediateCertDerPath))

/** {@inheritDoc EnvDef.rootCertCrtPath} */
export const rootCertCrtPath = Env.pipe(Effect.map((_) => _.rootCertCrtPath))

/** {@inheritDoc EnvDef.intermediateCertCrtPath} */
export const intermediateCertCrtPath = Env.pipe(Effect.map((_) => _.intermediateCertCrtPath))

/** {@inheritDoc EnvDef.serialNumbersFile} */
export const serialNumbersFile = Env.pipe(Effect.map((_) => _.serialNumbersFile))
