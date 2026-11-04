import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { Config, ConfigProvider, Layer, Option, Schema } from "effect"
import { Config as ServicesConfig, Schemas, Services } from "homelab-services"
import * as path from "node:path"
import { Config as NodeConfig, Layers } from "../src/index.js"
import { DPoPProofBuilderServiceLive } from "./dpop.js"

const privateDir = path.resolve(import.meta.dirname, "..", "private")

const TestConfigProvider = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    HOMELAB_ORIGIN_URL: "http://localhost:3000",
    HOMELAB_SECRET_FILE: path.join(privateDir, "hmac-secret"),
    TOKEN_ISSUER_PRIVATE_KEY_PATH: path.join(privateDir, "jwk.json"),
    TOKEN_ISSUER_PRIVATE_KEY_SECRET_PATH: path.join(privateDir, "private-key-secret"),
    TOKEN_ISSUER_PUBLIC_KEY_PATH: path.join(privateDir, "jwk.pub.json"),
    API_KEYS_FILE: path.join(privateDir, "api-keys"),
    FEATURE_FLAGS: "*",
    ROOT_CERT_DER: path.join(privateDir, "root.crt"),
    INTERMEDIATE_CERT_DER: path.join(privateDir, "intermediate.crt"),
    ROOT_CERT_CRT: path.join(privateDir, "root.crt"),
    INTERMEDIATE_CERT_CRT: path.join(privateDir, "intermediate.crt"),
    KANIDM_OPENID_PROVIDER_URL: "https://kanidm.test/oauth2/openid/test/.well-known/openid-configuration",
    SERIAL_NUMBERS_FILE: path.join(privateDir, "serial-numbers.json"),
  }),
)

const TestEnvLive = Layer.effect(
  ServicesConfig.Env.Env,
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
    chromeExecutable: Config.option(Config.String("CHROME_EXECUTABLE")),
    resumeSiteUrl: Config.withDefault(
      Config.schema(Schema.URLFromString, "RESUME_SITE_URL"),
      new URL("https://resume.rae-hill.dev"),
    ),
  }),
).pipe(Layer.provide(TestConfigProvider))

export const makeTestEnvWithFlags = (
  featureFlags: Schemas.FeatureFlags.FeatureFlagsSet,
): Layer.Layer<ServicesConfig.Env.Env> =>
  Layer.succeed(ServicesConfig.Env.Env, {
    originUrl: new URL("http://localhost:3000"),
    tokenIssuerPrivateKeyPath: Option.some(path.join(privateDir, "jwk.json")),
    tokenIssuerPrivateKeySecretFile: Option.some(path.join(privateDir, "private-secret-key")),
    tokenIssuerPublicKeyPath: Option.some(path.join(privateDir, "jwk.pub.json")),
    hmacSecretFilePath: Option.some(path.join(privateDir, "hmac-secret")),
    featureFlags,
    kanidmOidcUrl: new URL("https://kanidm.test/oauth2/openid/test/.well-known/openid-configuration"),
    caUrl: new URL("https://ca.plato-splunk.media"),
    acmeDirectoryPath: "/acme/acme/directory",
    hardwareBound: true,
    keyType: "ECSECPrimeRandom",
    keySize: 384,
    apiKeysFilePath: path.join(privateDir, "api-keys"),
    rootCertDerPath: path.join(privateDir, "root.crt"),
    intermediateCertDerPath: path.join(privateDir, "intermediate.crt"),
    rootCertCrtPath: path.join(privateDir, "root.crt"),
    intermediateCertCrtPath: path.join(privateDir, "intermediate.crt"),
    serialNumbersFile: Option.some(path.join(privateDir, "serial-numbers.json")),
    chromeExecutable: Option.none(),
    resumeSiteUrl: new URL("https://resume.test"),
  })

const TestRemoteOIDCWellKnownDetails = Layer.succeed(
  ServicesConfig.OIDCConfigRemote.RemoteOIDCWellKnownDetailsService,
  {
    kanidm: Option.some({
      issuer: "https://kanidm.test/oauth2/openid/test",
      authorizationEndpoint: "https://kanidm.test/ui/oauth2",
      tokenEndpoint: "https://kanidm.test/oauth2/token",
      userInfoEndpoint: "https://kanidm.test/oauth2/openid/test/userinfo",
      jwksUri: new URL("https://kanidm.test/oauth2/openid/test/public_key.jwk"),
      revocationEndpoint: new URL("https://kanidm.test/oauth2/revoke"),
      introspectionEndpoint: new URL("https://kanidm.test/oauth2/introspect"),
    }),
  },
)

export const TestIssuerJwkResolver = NodeConfig.IssuerJwkResolverLive.pipe(
  Layer.provide(TestRemoteOIDCWellKnownDetails),
  Layer.provide(TestEnvLive),
  Layer.provide(NodeFileSystem.layer),
)

export const TestHMACService = Layers.HMACService.HMACServiceLive.pipe(
  Layer.provide(TestEnvLive),
  Layer.provide(NodeFileSystem.layer),
)

export const TestNonceService = Layers.NonceService.NonceServiceLive.pipe(
  Layer.provideMerge(TestHMACService),
)

export const TestDPoPTokenValidatorService = Layers.DPoPTokenValidatorService.DPoPTokenValidatorServiceLive.pipe(
  Layer.provideMerge(TestNonceService),
)

export const TestApiKeyConfig = NodeConfig.ApiKeyConfigLive.pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(TestConfigProvider),
)

export const TestSerialNumberConfig = Layer.succeed(
  ServicesConfig.SerialNumberConfig.SerialNumberConfig,
  { resolveIp: () => Option.none() },
)

export const TestDPoPProofBuilderService = DPoPProofBuilderServiceLive

export const IntegrationTestLayer = Layer.mergeAll(
  TestIssuerJwkResolver,
  TestHMACService,
  TestNonceService,
  TestDPoPTokenValidatorService,
  TestApiKeyConfig,
  TestSerialNumberConfig,
  TestDPoPProofBuilderService,
  NodeFileSystem.layer,
)

export { Services }
