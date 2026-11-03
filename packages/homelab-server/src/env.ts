import { Config, Layer, Schema } from "effect"
import { Config as HomelabConfig, Schemas } from "homelab-services"

export const EnvLive = Layer.effect(
  HomelabConfig.Env.Env,
  Config.all({
    originUrl: Config.schema(Schema.URLFromString, "HOMELAB_ORIGIN_URL"),
    tokenIssuerPrivateKeyPath: Config.option(Config.String("TOKEN_ISSUER_PRIVATE_KEY_PATH")),
    tokenIssuerPrivateKeySecretFile: Config.option(Config.String("TOKEN_ISSUER_PRIVATE_KEY_SECRET_PATH")),
    tokenIssuerPublicKeyPath: Config.option(Config.String("TOKEN_ISSUER_PUBLIC_KEY_PATH")),
    hmacSecretFilePath: Config.option(Config.String("HOMELAB_SECRET_FILE")),
    featureFlags: Config.schema(Schemas.FeatureFlags.FeatureFlagsSetSchema, "FEATURE_FLAGS"),
    kanidmOidcUrl: Config.schema(Schema.URLFromString, "KANIDM_OPENID_PROVIDER_URL"),
    caUrl: Config.withDefault(Config.schema(Schema.URLFromString, "CA_URL"), new URL("https://ca.plato-splunk.media")),
    acmeDirectoryPath: Config.withDefault(Config.String("ACME_DIRECTORY_PATH"), "/acme/acme/directory"),
    hardwareBound: Config.withDefault(Config.Boolean("ACME_HARDWARE_BOUND"), true),
    keyType: Config.withDefault(Config.String("ACME_KEY_TYPE"), "ECSECPrimeRandom"),
    keySize: Config.withDefault(Config.Int("ACME_KEY_SIZE"), 384),
    apiKeysFilePath: Config.String("API_KEYS_FILE"),
    rootCertDerPath: Config.String("ROOT_CERT_DER"),
    intermediateCertDerPath: Config.String("INTERMEDIATE_CERT_DER"),
    rootCertCrtPath: Config.String("ROOT_CERT_CRT"),
    intermediateCertCrtPath: Config.String("INTERMEDIATE_CERT_CRT"),
    serialNumbersFile: Config.option(Config.String("SERIAL_NUMBERS_FILE")),
  }),
)
