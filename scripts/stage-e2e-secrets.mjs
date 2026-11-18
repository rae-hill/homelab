/**
 * Stages machine-local, NON-SECRET fixtures so the bundled homelab-server can
 * boot for e2e runs in ANY fresh checkout/worktree/CI runner:
 *
 * - packages/homelab-server/.env-serve-test       — env file for `yarn workspace homelab-server serve:test` (dotenvx)
 * - packages/homelab-server/private/api-keys.json — the test API keys the e2e suite authenticates with
 * - packages/homelab-server/private/jwk.json      — token-issuer private key as a flattened JWE
 *   (the server's IssuerJwkResolver expects PBES2-HS256+A128KW + A256GCM, decrypted with jwk-secret)
 * - packages/homelab-server/private/jwk.pub.json  — token-issuer public JWK (ES256)
 * - packages/homelab-server/private/jwk-secret    — PBES2 passphrase for jwk.json
 * - packages/homelab-server/private/hmac-secret   — nonce HMAC secret (64 hex chars)
 * - packages/homelab-server/private/serial-numbers.json — IP → serial map for the
 *   EAP-TLS wifi fine-grained-authorization tests (recognized-IP contract)
 * - packages/homelab-server/private/openrouter-api-key — dummy OpenRouter key so the
 *   server boots without a real one (e2e must never hit OpenRouter)
 *
 * Also runs stage-test-secrets.mjs (homelab-services-node unit-test fixtures),
 * since the e2e workspace transitively imports that package's test-utils.
 *
 * Secret VALUES come from SecretSpec when available (repo-root
 * secretspec.toml, profiles e2e/development — generated fresh per run, null
 * provider = nothing stored): scripts/e2e.sh invokes this script under
 * `secretspec run --profile e2e`, which injects JWK_PASSPHRASE and
 * HMAC_SECRET. In that mode the secret-derived fixtures (the JWK JWE + its
 * passphrase file, the public JWK, hmac-secret — at whatever paths the
 * effective .env-serve-test references, so hand-tuned setups stay
 * consistent) are ALWAYS regenerated from the injected values — the JWE is
 * only decryptable with the matching passphrase, so both must come from the
 * same generation event — and secret files are pinned 0600.
 *
 * Without injection (plain `node scripts/stage-e2e-secrets.mjs`, e.g. CI
 * runners without Nix) everything is freshly self-generated random material
 * in gitignored paths and the script is fully idempotent: existing files are
 * NEVER overwritten, so developer machines keep their hand-tuned
 * .env-serve-test and real key material. Delete a file to regenerate it.
 *
 * The static contract files (api-keys.json, serial-numbers.json,
 * .env-serve-test, the openrouter dummy) are never secret-derived and keep
 * never-overwrite semantics in BOTH modes. Invoked automatically by
 * scripts/e2e.sh; safe to run standalone.
 */
import { CompactEncrypt, exportJWK } from "jose"
import { randomBytes } from "node:crypto"
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import * as path from "node:path"

// Also stage the services-node unit-test fixtures (module runs on import).
await import("./stage-test-secrets.mjs")

const repoRoot = path.resolve(import.meta.dirname, "..")
const serverDir = path.join(repoRoot, "packages", "homelab-server")
const privateDir = path.join(serverDir, "private")

// Ephemeral secrets injected by SecretSpec (repo-root secretspec.toml;
// scripts/e2e.sh and the devshell's seed-secrets command run this file under
// `secretspec run --profile e2e|development`). Both values arrive together or
// not at all; their presence switches this run into fresh-generation mode
// where the secret-derived fixtures are ALWAYS rewritten — the jwk.json JWE
// is only decryptable with the matching passphrase, so both must come from
// the same generation event. Without injection (e.g. CI runners without Nix)
// the legacy behavior applies: self-generate, never overwrite.
const injectedPassphrase = process.env.JWK_PASSPHRASE
const injectedHmac = process.env.HMAC_SECRET
const secretspecMode = injectedPassphrase !== undefined && injectedHmac !== undefined
if (!secretspecMode && (injectedPassphrase !== undefined || injectedHmac !== undefined)) {
  console.error("ERROR: only one of JWK_PASSPHRASE / HMAC_SECRET is set — expected both (secretspec run)")
  process.exit(1)
}

// Parse the (possibly hand-tuned) .env-serve-test so the derived fixtures are
// regenerated at the paths the server will ACTUALLY read: the JWE and its
// passphrase must come from the same generation event, wherever the env file
// points them (hand-tuned setups may reference e.g. ./private/private-key-secret
// instead of the stock ./private/jwk-secret — regenerating a mismatched pair
// fails boot with JWEDecryptionFailed). Relative paths resolve against
// packages/homelab-server (dotenvx's CWD); a missing file/keys falls back to
// the stock names. This reads PATHS only — never secret material.
const readEnvFile = async (file) => {
  const env = {}
  try {
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
      if (m) env[m[1]] = m[2]
    }
  } catch {
    // missing env file → stock defaults below
  }
  return env
}
const serveTestEnv = await readEnvFile(path.join(serverDir, ".env-serve-test"))
const fromServerDir = (value, fallback) => path.resolve(serverDir, value || fallback)
const jwkPath = fromServerDir(serveTestEnv.TOKEN_ISSUER_PRIVATE_KEY_PATH, "./private/jwk.json")
const jwkSecretPath = fromServerDir(serveTestEnv.TOKEN_ISSUER_PRIVATE_KEY_SECRET_PATH, "./private/jwk-secret")
const jwkPubPath = fromServerDir(serveTestEnv.TOKEN_ISSUER_PUBLIC_KEY_PATH, "./private/jwk.pub.json")
const hmacSecretPath = fromServerDir(serveTestEnv.HOMELAB_SECRET_FILE, "./private/hmac-secret")

const exists = async (file) => {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

const stage = async (file, generate, { overwrite = false, secret = false } = {}) => {
  const rel = path.relative(process.cwd(), file)
  if (!overwrite && (await exists(file))) {
    console.log(`skip (exists): ${rel}`)
    return
  }
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, await generate(), secret ? { mode: 0o600 } : undefined)
  // writeFile's mode only applies when the file is CREATED — pin it on overwrites too.
  if (secret) await chmod(file, 0o600)
  console.log(`${overwrite ? "regenerated" : "staged"}: ${rel}`)
}

/**
 * The e2e suite's API-key contract — must match
 * packages/homelab-e2e-tests/test-utils/testing-layer.ts (TEST_API_KEY,
 * TEST_LIMITED_API_KEY, TEST_LIMITED_CERTS_KEY) and the permissions each
 * test asserts.
 */
const apiKeys = [
  {
    apiKey: "test-api-key-1",
    permissions: [
      "Config_Wifi",
      "Config_Certs",
      "Config_DNS",
      "Status_Health",
      "Status_Self",
      "OAuth_Token",
      "OAuth_ClaimCheck",
      "Cert_Root",
      "Cert_Intermediate",
      "Cert_Combined",
      "Resume_Print",
      "Resume_Tailor",
    ],
    email: "test@a.plato-splunk.media",
  },
  {
    apiKey: "test-limited-api-key-1",
    permissions: ["Config_Certs", "OAuth_Token"],
    email: "guest-a@a.plato-splunk.media",
  },
  {
    apiKey: "test-limited-api-key-2",
    permissions: ["OAuth_Token"],
    email: "guest-b@a.plato-splunk.media",
  },
]

/** Fresh ES256 (P-256) issuer key material; private key wrapped as a flattened JWE. */
const generateIssuerKeys = async (passphrase) => {
  const { privateKey, publicKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])

  const kid = randomBytes(16).toString("base64url")
  const jwkSecret = passphrase ?? randomBytes(32).toString("base64url")

  const clean = (jwk) => {
    delete jwk.key_ops
    delete jwk.ext
    return { ...jwk, alg: "ES256", use: "sig", kid }
  }
  const privateJwk = clean(await exportJWK(privateKey))
  const publicJwk = clean(await exportJWK(publicKey))

  // The server decrypts with jose's flattenedDecrypt (PBES2-HS256+A128KW), but
  // jose only exports compact encryption publicly — encrypt compact, then
  // re-map the five serialization parts into the flattened JSON shape.
  const compact = await new CompactEncrypt(new TextEncoder().encode(JSON.stringify(privateJwk)))
    .setProtectedHeader({ alg: "PBES2-HS256+A128KW", enc: "A256GCM", cty: "jwk+json" })
    .encrypt(new TextEncoder().encode(jwkSecret))
  const [protectedHeader, encryptedKey, iv, ciphertext, tag] = compact.split(".")

  return {
    jwe: JSON.stringify({
      protected: protectedHeader,
      encrypted_key: encryptedKey,
      iv,
      ciphertext,
      tag,
    }),
    publicJwk: JSON.stringify(publicJwk),
    jwkSecret,
  }
}

/**
 * IP → device-serial map consumed by the fine-grained authorization service
 * for EAP-TLS wifi requests (x-forwarded-for lookup). Contract with the e2e
 * suite: src/mobile-config/wifi.test.ts expects 192.168.1.10 to be RECOGNIZED
 * and 10.0.0.99 to be unrecognized (absent here). Non-secret test values.
 */
const serialNumbers = {
  "192.168.1.10": "TEST-SERIAL-001",
  "100.64.0.1": "TEST-SERIAL-002",
}

/**
 * Env for `yarn workspace homelab-server serve:test` (dotenvx, CWD =
 * packages/homelab-server). PORT / HOMELAB_ORIGIN_URL / E2E_BASE_URL are NOT
 * set here — scripts/e2e.sh exports them and dotenvx never overrides existing
 * process env. Optional vars with server-side defaults (CA_URL, ACME_*,
 * SERIAL_NUMBERS_FILE, LOG_STYLE, CHROME_EXECUTABLE, RESUME_SITE_URL) are
 * intentionally omitted. KANIDM_OPENID_PROVIDER_URL is required by the server
 * config but only fetched opportunistically at startup (failure degrades to
 * "remote OIDC verification unavailable", which the e2e suite never exercises).
 */
const envServeTest = `# Generated by scripts/stage-e2e-secrets.mjs — safe defaults for local e2e.
# Existing files are never overwritten; edit freely, delete to regenerate.
TOKEN_ISSUER_PRIVATE_KEY_PATH=./private/jwk.json
TOKEN_ISSUER_PRIVATE_KEY_SECRET_PATH=./private/jwk-secret
TOKEN_ISSUER_PUBLIC_KEY_PATH=./private/jwk.pub.json
HOMELAB_SECRET_FILE=./private/hmac-secret
FEATURE_FLAGS=*
KANIDM_OPENID_PROVIDER_URL=https://idm.plato-splunk.media/oauth2/openid/homelab/.well-known/openid-configuration
API_KEYS_FILE=./private/api-keys.json
SERIAL_NUMBERS_FILE=./private/serial-numbers.json
OPENROUTER_API_KEY_FILE=./private/openrouter-api-key
ROOT_CERT_DER=../../certs/alford-root.der
INTERMEDIATE_CERT_DER=../../certs/intermediate_ca_2.der
ROOT_CERT_CRT=../../certs/alford-root.crt
INTERMEDIATE_CERT_CRT=../../certs/intermediate_ca_2.crt
`

console.log(
  secretspecMode
    ? "secretspec mode: injected ephemeral secrets — derived fixtures regenerated"
    : "standalone mode: self-generating missing fixtures (never overwrites existing files)",
)

await mkdir(privateDir, { recursive: true })

const { jwe, publicJwk, jwkSecret } = await generateIssuerKeys(injectedPassphrase)

await stage(path.join(privateDir, "api-keys.json"), async () => JSON.stringify(apiKeys, null, 2))
await stage(jwkPath, async () => jwe, { overwrite: secretspecMode, secret: true })
await stage(jwkPubPath, async () => publicJwk, { overwrite: secretspecMode })
await stage(jwkSecretPath, async () => jwkSecret, { overwrite: secretspecMode, secret: true })
await stage(hmacSecretPath, async () => injectedHmac ?? randomBytes(32).toString("hex"), {
  overwrite: secretspecMode,
  secret: true,
})
await stage(path.join(privateDir, "serial-numbers.json"), async () => JSON.stringify(serialNumbers, null, 2))
await stage(path.join(privateDir, "openrouter-api-key"), async () => "sk-or-e2e-dummy-not-a-real-key")
await stage(path.join(serverDir, ".env-serve-test"), async () => envServeTest)
