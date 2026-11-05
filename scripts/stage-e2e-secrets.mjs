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
 *
 * Also runs stage-test-secrets.mjs (homelab-services-node unit-test fixtures),
 * since the e2e workspace transitively imports that package's test-utils.
 *
 * Everything is freshly generated random material in gitignored paths — it
 * mimics the sops-managed production layout without any real secrets. The
 * api-keys.json content is the e2e suite's contract (key IDs + permissions,
 * mirroring packages/homelab-e2e-tests/test-utils/testing-layer.ts and the nix
 * apiKeys permissions enum); the key strings double as throwaway client
 * secrets, so this file must only ever contain these test values.
 *
 * Idempotent: existing files are NEVER overwritten, so developer machines
 * keep their hand-tuned .env-serve-test and real key material. Delete a file
 * to regenerate it. Invoked automatically by scripts/e2e.sh; safe to run
 * standalone:  node scripts/stage-e2e-secrets.mjs
 */
import { CompactEncrypt, exportJWK } from "jose"
import { randomBytes } from "node:crypto"
import { access, mkdir, writeFile } from "node:fs/promises"
import * as path from "node:path"

// Also stage the services-node unit-test fixtures (module runs on import).
await import("./stage-test-secrets.mjs")

const repoRoot = path.resolve(import.meta.dirname, "..")
const serverDir = path.join(repoRoot, "packages", "homelab-server")
const privateDir = path.join(serverDir, "private")

const exists = async (file) => {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

const stage = async (file, generate) => {
  const rel = path.relative(process.cwd(), file)
  if (await exists(file)) {
    console.log(`skip (exists): ${rel}`)
    return
  }
  await writeFile(file, await generate())
  console.log(`staged: ${rel}`)
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
const generateIssuerKeys = async () => {
  const { privateKey, publicKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])

  const kid = randomBytes(16).toString("base64url")
  const jwkSecret = randomBytes(32).toString("base64url")

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
ROOT_CERT_DER=../../certs/alford-root.der
INTERMEDIATE_CERT_DER=../../certs/intermediate_ca_2.der
ROOT_CERT_CRT=../../certs/alford-root.crt
INTERMEDIATE_CERT_CRT=../../certs/intermediate_ca_2.crt
`

await mkdir(privateDir, { recursive: true })

const { jwe, publicJwk, jwkSecret } = await generateIssuerKeys()

await stage(path.join(privateDir, "api-keys.json"), async () => JSON.stringify(apiKeys, null, 2))
await stage(path.join(privateDir, "jwk.json"), async () => jwe)
await stage(path.join(privateDir, "jwk.pub.json"), async () => publicJwk)
await stage(path.join(privateDir, "jwk-secret"), async () => jwkSecret)
await stage(path.join(privateDir, "hmac-secret"), async () => randomBytes(32).toString("hex"))
await stage(path.join(serverDir, ".env-serve-test"), async () => envServeTest)
