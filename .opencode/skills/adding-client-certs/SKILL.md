---
name: adding-client-certs
description: End-to-end workflow for adding a new step-ca client-certificate use — hand-coded JWK/ACME provisioner with UUID extension and serial→user template mapping, sops secrets, issuance, renewal wiring. Covers both the YubiKey-attested model (device-attest-01, key in PIV slot) and the portable per-use model (software key, encrypted bundle publishable to the NAS). Use when adding client certs for mTLS, a new `client-<use>` provisioner, enrolling a YubiKey or Apple device serial identity, or wiring cert renewal/publishing.
---

# Skill: Adding Client Certs

Companion to `docs/step-client-certs-plan.md` (read its §4 for the authorization model).
Provisioners in this repo are **always hand-coded** in
`nix-config/modules/services/step-ca.nix` — never created dynamically via the step-ca admin
API. This skill is the checklist that compensates.

Two models:

- **Model A — YubiKey-attested**: key generated in a PIV slot, cert issued via ACME
  `device-attest-01` (`step` attestation format), CN = YubiKey serial. Key never leaves the
  token; only the workstation can use it. Renewal: `step ca renew <crt> 'yubikey:...' --daemon`.
- **Model B — portable per-use**: software key + dedicated `client-<use>` JWK provisioner.
  Cert+key encrypted at rest; publishable anywhere (e.g. `.p12` → `/home/jacob/cloud/certs/<use>/`
  for iOS). Renewal: `step ca renew --daemon --exec <publish>`.

Both models stamp authorization fields **server-side via the provisioner template**: a
per-provisioner **UUID custom extension** (the authoritative validation field), **OU = owning
kanidm user**, and `clientAuth`-only EKU. Serial-based identities (YubiKey/Apple) additionally
pass through a **`devices` serial→user map** in `templateData` that fails closed on unknown
serials.

> Status note: until the `step-client-cert` NixOS module and `yubikey-client-cert` HM module
> land (plan §6), issuance/renewal below are manual commands; the provisioner/secret/template
> steps apply either way.

## Decide first

| Question     | Options                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model        | A (YubiKey PIV, workstation-only) / B (portable, exportable key)                                                                                         |
| Use name     | kebab-case, e.g. `mobile`, `docs`, `jacob-workstation`                                                                                                   |
| Subject (CN) | B: `<use>@plato-splunk.media` (passes existing policy). A: YubiKey serial (must be allowlisted, step 2c)                                                 |
| Owner        | kanidm username (→ OU)                                                                                                                                   |
| Durations    | provisioner `claims`: default/max `TLSCertDuration` (B: ~720h balances iOS re-import cadence; A: ≤729h, weighed against how often the key is plugged in) |
| Output       | B only: publish path (NAS?) + bundle format (`.p12`, `--legacy`?)                                                                                        |

## Step 1 — Generate identity material (one-time, local)

```sh
# Provisioner UUID (the validation-field value):
uuidgen | tr 'A-Z' 'a-z'          # → e.g. 6f9d0e62-4f2b-4a1c-9d3e-8b7c6a5d4e3f

# Namespace OID for the custom extension (once for the whole homelab, lives in constants.nix
# as ca.clientCertIdOid — skip if already defined):
#   OID = 2.25.<decimal form of a namespace UUID>   (ISO UUID-derived arc, no PEN needed)
uuidgen                                        # namespace UUID
python3 -c "import uuid,sys; print(uuid.UUID(sys.argv[1]).int)" <namespace-uuid>
# → ca.clientCertIdOid = "2.25.<that integer>";
```

Model B only — provisioner JWK keypair (private key gets password-encrypted; both the password
and the key file go to sops in step 3):

```sh
step crypto jwk create client-<use>-pub.json client-<use>-priv.json \
  --kty EC --crv P-256 --use sig --password-file <(echo '<new-provisioner-password>')
# flags verified in repos/step-cli/command/crypto/jwk/create.go — check --help if unsure
```

## Step 2 — Hand-code the provisioner

### 2a. Standard x509 template (shared shape)

```json
{
  "subject": {
    "commonName": {{ toJson .Subject.CommonName }},
    "organizationalUnit": {{ toJson .User.owner }}
  },
  "sans": {{ toJson .SANs }},
  "keyUsage": ["digitalSignature"],
  "extKeyUsage": ["clientAuth"],
  "extensions": [
    {
      "id": {{ toJson .User.certIdOid }},
      "critical": false,
      "value": {{ toJson (.User.uuid | b64enc) }}
    }
  ]
}
```

- `.User` = the provisioner's `templateData` (`repos/crypto/x509util/templates.go:15`;
  `repos/step-ca/authority/provisioners.go:497`).
- `extensions[].value` is JSON `[]byte` ⇒ **base64 string**
  (`repos/crypto/x509util/extensions.go:253-290`); Nix can precompute
  `builtins.base64Encode uuid` into `templateData` instead of sprig `b64enc`.
- For **serial-based identities** (Model A / Apple `eap`), replace the `organizationalUnit`
  line with a fail-closed map lookup:

```json
"organizationalUnit": {{ $cn := .Insecure.CR.Subject.CommonName }}{{ $u := index .User.devices $cn }}{{ if not $u }}{{ fail (printf "unknown device serial %q" $cn) }}{{ end }}{{ toJson $u }}
```

(ACME device-attest templates read the CSR via `.Insecure.CR`; keep the existing `eap`
template's DN-SAN line if editing that provisioner.)

### 2b. Model B: JWK provisioner block in `services/step-ca.nix`

Follow the existing host-JWK pattern (`services/step-ca.nix:169-232`):

```nix
{
  type = "JWK";
  name = "client-<use>.${c.baseDomain}";
  key = { "use" = "sig"; "kty" = "EC"; "kid" = "<from pub.json>"; "crv" = "P-256"; "alg" = "ES256";
          "x" = "<from pub.json>"; "y" = "<from pub.json>"; };
  claims = { "defaultTLSCertDuration" = "720h"; "maxTLSCertDuration" = "720h"; };
  options.x509 = {
    template = ''<2a JSON>'';
    templateData = {
      uuid = "<provisioner uuid>";
      certIdOid = c.ca.clientCertIdOid;
      owner = "<kanidm-user>";
    };
  };
}
```

(`options.x509.{template,templateFile,templateData}` shape:
`repos/step-ca/authority/provisioner/options.go:80-87`.)

### 2c. Model A: ACME provisioner + serial allowlist

- Either reuse `eap` or add a dedicated `yk-client` ACME provisioner (plan §8 Open #2):
  `challenges = [ "device-attest-01" ]`, `attestationFormats = [ "step" ]` (add `"apple"` only
  for the shared `eap` one), claims ≤ 729h, template from 2a with the devices-map variant.
- Add the YubiKey serial to **both**:
  - `x509PermittedCommonNames` in `nix-config/modules/constants.nix` (name policy), and
  - the shared `devices` map (`constants.nix`) consumed by the template (fail-closed gate).
- Apple device serials belong in the same `devices` map.

### 2d. OID constant

If not yet present: `ca.clientCertIdOid = "2.25.<namespace-uuid-decimal>";` in the `ca` attrset
of `nix-config/modules/service-registry.nix`/`constants.nix` (wherever `ca.*` constants live).

## Step 3 — sops secrets (consuming host's `secrets/<host>.yaml`)

| Secret                   | Contents                                            | Used by                                     |
| ------------------------ | --------------------------------------------------- | ------------------------------------------- |
| `client_<use>_jwk`       | provisioner private JWK JSON (from step 1)          | `step ca token --key`                       |
| `client_<use>_prov_pw`   | provisioner password (decrypts the JWK)             | `step ca token --password-file`             |
| `client_<use>_key_pw`    | passphrase for the cert's encrypted `key.pem`       | `step ca certificate/renew --password-file` |
| `client_<use>_p12_pw`    | `.p12` bundle passphrase (typed into iOS on import) | `step certificate p12 --password-file`      |
| `yk_client_pin` (A)      | PIV PIN                                             | `pin-source=` in yubikey URIs               |
| `yk_client_mgmt_key` (A) | PIV management key (enrollment only)                | `management-key-source=`                    |

Declare per host in `_private/<host>/sops.nix` (system services) and/or the `sops` block of
`home/jacob-nixos.nix` (HM/user services → `/run/user/1000/secrets/<name>`). Encrypt with
`sops nix-config/secrets/<host>.yaml` (recipients in `.sops.yaml`). **All passphrases live in
sops** so they can be pulled up for iOS imports.

## Step 4 — Deploy + verify the CA side

```sh
git add <new/changed .nix files>            # flake evaluates the git tree!
nix build .#checks.x86_64-linux.shellcheck
nixos-rebuild build --flake .#cicero        # then deploy cicero per your usual flow
step ca provisioner list --ca-url https://ca.plato-splunk.media \
  --root certs/alford-root.crt | jq '.[].name'   # expect client-<use>… / yk-client
```

**Template sandbox (recommended before touching cicero):** spin a throwaway CA
(`step ca init` with software keys in a temp STEPPATH), copy the provisioner block into its
`ca.json`, issue a test cert, and `step certificate inspect` it — confirms the UUID extension
renders, OU stamps, and unknown serials fail closed.

## Step 5 — Issue

### Model B (portable)

```sh
tok=$(step ca token "<use>@plato-splunk.media" \
  --provisioner "client-<use>.plato-splunk.media" \
  --key <(sops exec-file ... ) \            # provisioner private JWK (sops)
  --password-file <prov-pw-file> \
  --ca-url https://ca.plato-splunk.media --root certs/alford-root.crt)
step ca certificate "<use>@plato-splunk.media" cert.crt key.pem \
  --token "$tok" --password-file <key-pw-file>       # key.pem written encrypted
```

(Token flow mirrors `services/ssh-cert-renewer.nix:55-105`.)

### Model A (YubiKey; key plugged in)

```sh
ykman list                                   # serial; ykman info → firmware 5.x
# one-time slot key generation (management key + PIN; confirm syntax: step-kms-plugin create --help):
step-kms-plugin create "yubikey:slot-id=9a?serial=<serial>&pin-source=$PIN&management-key-source=$MGMT"
step ca certificate <serial> yk-<serial>.crt \
  --attestation-uri "yubikey:slot-id=9a?serial=<serial>&pin-source=$PIN" \
  --acme https://ca.plato-splunk.media/acme/<yk-client|eap>/directory \
  --root certs/alford-root.crt --not-after 720h
```

(Subject **must** equal the YubiKey serial — CA checks attested serial == order identifier,
`repos/step-ca/acme/challenge.go:903`. Requires `step-kms-plugin` in PATH.)

### Verify the cert

```sh
step certificate inspect cert.crt     # CN, OU=<kanidm user>, EKU=clientAuth, validity
openssl x509 -in cert.crt -noout -text | grep -A1 '2\.25\.'   # UUID extension present
step certificate verify --roots certs/alford-root.crt cert.crt
```

## Step 6 — Renewal (+ publishing)

- **Implemented modules (once landed):** add a `services.step-client-cert.<use>` instance
  (Model B) or the `yubikey-client-cert` HM config (Model A) — see plan §2.4/§3.4.
- **Manual equivalent:**
  ```sh
  # Model B (+ optional publish hook):
  step ca renew cert.crt key.pem --password-file <key-pw> --daemon \
    --exec "<publish.sh>" --ca-url https://ca.plato-splunk.media --root <root>
  # Model A:
  step ca renew yk-<serial>.crt "yubikey:slot-id=9a?serial=<serial>&pin-source=$PIN" \
    --daemon --ca-url https://ca.plato-splunk.media --root <root>
  ```
  The daemon renews at 2/3 of validity by default and **retries every minute on failure**
  (YubiKey unplugged / NAS down / CA unreachable) without exiting
  (`repos/step-cli/command/ca/renew.go:549-556`).
- **Model B publish** (`.p12` → NAS): `step certificate p12 bundle.p12 cert.crt key.pem
  --ca <root> --password-file <p12-pw> [--legacy]`, atomic `mv` into
  `/home/jacob/cloud/certs/<use>/`; retry loop for the CIFS automount.

## Checklist (condensed)

- [ ] Model + use name + owner + durations decided
- [ ] Provisioner UUID generated (and namespace OID exists in `constants.nix`)
- [ ] (B) JWK keypair created; pub fields copied into provisioner block
- [ ] Provisioner hand-coded in `services/step-ca.nix` with template (UUID ext + OU/owner,
      devices-map variant for serial identities) + claims
- [ ] (A/serial) serial added to `x509PermittedCommonNames` + `devices` map
- [ ] sops secrets added + declared on consuming host(s)
- [ ] `git add` → shellcheck → `nixos-rebuild build .#cicero` → deploy → `step ca provisioner list`
- [ ] Template sandbox render verified (inspect: UUID ext, OU, clientAuth, fail-closed)
- [ ] Cert issued + inspected (Model A: enrollment runbook; Model B: token flow)
- [ ] Renewal wired (module instance or daemon unit) + publish path tested (B)
- [ ] iOS import tested if the bundle targets devices (settle `--legacy`)
- [ ] `docs/step-client-certs-plan.md` status/decisions updated if anything deviated

## References

- Plan + authorization model: `docs/step-client-certs-plan.md` (§2 Model A, §3 Model B, §4 lockdown)
- CA config: `nix-config/modules/services/step-ca.nix` (provisioners `:106-233`, policy `:55-75`)
- Token-flow precedent: `nix-config/modules/services/ssh-cert-renewer.nix:55-105`
- Source of truth (vendored, pinned to deployed versions): `repos/step-ca/` (v0.29.0),
  `repos/step-cli/` (v0.30.2), `repos/crypto/` (v0.77.1) — prefer these over web docs
- EAP-TLS/Apple serial precedent: `docs/eap-tls-prerequisites.md`,
  `packages/homelab-services-node/src/layers/acme-config-service.ts`
