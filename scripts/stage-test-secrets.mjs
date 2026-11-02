/**
 * Stages randomly generated test secrets into
 * `packages/homelab-services-node/private/` for the homelab-services-node test
 * suite.
 *
 * The suite (via `test-utils/testing-layer.ts`) reads exactly two files:
 *
 * - `hmac-secret` — HMAC-SHA256 shared secret (64 hex chars) used by the
 *   nonce-service tests to sign/verify nonces.
 * - `jwk.json` — an ES256 (P-256) private key in JWKS shape used by the
 *   token-issuer / authorization-service tests.
 *
 * The other paths referenced by the test layer (api-keys, certs,
 * serial-numbers.json, ...) are either overridden in memory
 * (`TestSerialNumberConfig`) or never read, so they are not staged.
 *
 * Idempotent: existing files are never overwritten, so this is safe to run in
 * a devshell checkout where `private/` holds real (sops-managed) secrets. It
 * is intended for CI runners with fresh checkouts; see the Test job in
 * `.github/workflows/ci.yml`.
 */
import { randomBytes } from "node:crypto"
import { access, mkdir, writeFile } from "node:fs/promises"
import * as path from "node:path"

const privateDir = path.resolve(import.meta.dirname, "..", "packages/homelab-services-node/private")

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

/** Fresh ES256 P-256 private key exported as a JWKS document (matches the local fixture shape). */
const generateJwks = async () => {
  const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])
  const jwk = await crypto.subtle.exportKey("jwk", privateKey)
  delete jwk.key_ops
  delete jwk.ext
  Object.assign(jwk, { alg: "ES256", kid: "test-key-1", use: "sig" })
  return JSON.stringify({ jwks: [jwk] })
}

await mkdir(privateDir, { recursive: true })
await stage(path.join(privateDir, "hmac-secret"), async () => randomBytes(32).toString("hex"))
await stage(path.join(privateDir, "jwk.json"), generateJwks)
