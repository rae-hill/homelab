# Plan: Step Client Certificates — YubiKey-Attested Identity + Portable Per-Use Certs

Status: **PROPOSED**
Date: 2026-11-01
Revised: 2026-11-02 — review decisions: hand-coded provisioners only (+ new `adding-client-certs` skill), per-provisioner UUID custom extension as the validation field, serial→kanidm-user template mapping, Caddy leaf verifier rejected, all passphrases in sops, kanidm-unix/admin-account alignment captured as related workstreams.

## Goal

Two reusable, independently shippable mechanisms for step-ca–issued **X.509 client certificates**
(**both are being built**), plus a layered strategy for locking each certificate down to its
intended use:

1. **Model A — YubiKey-attested client cert** (`home-manager`, `jacob@nixos`): a client certificate
   whose private key is generated in and never leaves a YubiKey PIV slot, issued through step-ca's
   ACME `device-attest-01` challenge (`step` attestation format), kept current by a
   `step ca renew --daemon` user service. For mTLS client auth **on the workstation itself**.
2. **Model B — portable per-use client certs** (reusable module): software-key client certs issued
   through **dedicated, hand-coded per-use JWK provisioners** whose x509 templates stamp the
   authorization identity server-side: a **per-provisioner UUID custom extension** (the field
   future proxy/app verifiers check), the owning **kanidm user** (OU), and `clientAuth` EKU.
   Key stored encrypted (passphrases in sops), bundle re-published on every renewal to an
   arbitrary output location — first use case: an encrypted `.p12` on the NAS
   (`/home/jacob/cloud/...`) that iPhone/iPad apps (and NixOS services) consume for mTLS.

Authorization is anchored in **kanidm users** and enforced in layers: CA name policy → provisioner
templates (UUID extension + serial→user map) → app-layer identity mapping (`MTLSIdentity` in
homelab-api) → _(future)_ a custom Caddy extension validating cert fields at the proxy. See §4.

Because provisioners are hand-coded (never dynamically provisioned via the admin API), the
end-to-end "add a new client cert use" workflow is captured in the **`adding-client-certs`
skill** (`.opencode/skills/adding-client-certs/SKILL.md`).

**Why two models:** mTLS client auth requires proof of possession of the private key
(TLS 1.3 `CertificateVerify` signature; TLS 1.2 `CertificateVerify`/premaster decryption). A
certificate alone proves nothing — it is public. A PIV-resident key is non-exportable, so iOS apps
can never use a Model A key; conversely a Model B key must exist in exportable form to reach the
NAS. Hence the split: hardware-bound identity for the workstation, portable encrypted bundle for
everything else. Serial-number-based identities (Apple device serials, YubiKey serial) are kept —
they are excellent hardware-rooted CNs — with authentication control exercised through kanidm
users + the serial→user string map in step-ca templates (§4.2), which matters for EAP-TLS.

---

## 1. Current State

All facts below verified against the repo and the vendored upstream sources
(`repos/step-ca` = smallstep/certificates **v0.29.0**, `repos/step-cli` = smallstep/cli **v0.30.2**,
`repos/crypto` = go.step.sm/crypto **v0.77.1** — the exact versions nixpkgs-26.05 builds /
step-cli pins; subtrees added for this plan).

### 1.1 The CA

- step-ca **v0.29.0** on cicero only (`nix-config/modules/hosts/cicero.nix` →
  `nix-config/modules/services/step-ca.nix`), listening on `:443` as
  `https://ca.plato-splunk.media`. Root: `certs/alford-root.crt` (fingerprint
  `56c2...2392`), intermediate `certs/intermediate_ca_2.crt` (CN `PLATO SPLUNK YK2`), CA signing
  keys on cicero's YubiKey (PIV slots `9c`/`82`/`83`, `services/step-ca.nix:28,50-53`).
- Provisioners (`services/step-ca.nix:106-233`):

| Type   | Name                        | Notes                                                                                                                                                                                                                     |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACME   | `http`                      | http-01; max 73h / default 48h — all internal server certs (lego + Caddy)                                                                                                                                                 |
| ACME   | `eap`                       | **`device-attest-01`**, attestation formats `["apple" "step"]`, max 729h / default 480h, clientAuth-only template (`:119-148`) — Apple Secure Enclave certs today; **the `step` format is the YubiKey path Model A uses** |
| SSHPOP | `sshpop`                    | SSH only                                                                                                                                                                                                                  |
| OIDC   | `kanidm`                    | 2h user SSH certs — the existing kanidm-anchored auth path                                                                                                                                                                |
| JWK ×4 | `<host>.plato-splunk.media` | per-host, `enableSSHCA`; used by `ssh-cert-renewer` — **the hand-coded pattern Model B extends**                                                                                                                          |

- x509 name policy (`services/step-ca.nix:55-75`): allow DNS `*.plato-splunk.media` +
  `c.x509PermittedCommonNames` (currently the Apple device serials `G1447DK9FP`, `D2TN90JVJV`,
  `constants.nix:100-103`), email `@plato-splunk.media`, tailnet IPs; deny `postgres.*`/`root.*`.
  Policy is enforced on sign **and renew** paths via the name-policy validator
  (`repos/step-ca/authority/provisioner/jwk.go:210`).
- **No X.509 client-cert renewal daemon exists anywhere.** Server certs renew via
  `security.acme`/Caddy ACME; the only `step ... renew` in the repo is `ssh-cert-renewer`
  (`services/ssh-cert-renewer.nix:55-105`) — the working precedent for the JWK token flow
  (`step ca token --provisioner <p> --key <jwk-priv> --password-file <sops-secret>`) and for
  daily-timer renewal.

### 1.2 YubiKey / step tooling on the workstation

- `nixos` runs `pcscd` (via `programs/gnome-desktop.nix:17`); cicero additionally has polkit
  rules for non-session pcsc-lite access (`_private/cicero/security.nix:9-21`) — the precedent
  Model A needs for a lingering user service.
- Installed on `jacob@nixos`: `step-cli` (0.30.2), `yubikey-manager`. **`step-kms-plugin` is not
  installed anywhere** — and the CLI requires it for _every_ `yubikey:` URI operation (§2.1).
  nixpkgs packages it at 0.17.0 **with** pcsclite/opensc/softhsm support
  (`repos/nixpkgs-26.05/pkgs/by-name/st/step-kms-plugin/package.nix:28-45`).
- No opensc / pkcs11-provider on the workstation (relevant to Model A consumption, §2.5).
- `jacob` lingers on nixos (`_private/nixos/users.nix:7-9`); HM user-service precedent =
  `programs.opencode.web` → `systemd.user.services.opencode-web` (`home/jacob-nixos.nix:170-186`,
  `sd-switch` at `:703`); HM sops-nix active (`:84-89`, secrets land in
  `/run/user/1000/secrets/<name>`).

### 1.3 The vestigial skeleton

`nix-config/modules/features/acme-client-cert/{options,complete}.nix` +
`services/acme-client-cert.nix` define `services.acme-client-cert` (NixOS **and** darwin) with
options `certPath`, `ykSlot` ("The slot of the yubikey used to make the CSR"), `ykPinFilePath`
(`options.nix:8-21`) — but all implementation bodies are **empty** and no host imports the module.
This plan supersedes it (§8, Decided #10).

### 1.4 NAS + distribution

- The NAS (`10.76.100.190`, share `Personal-Drive`, LAN-only) is mounted on the workstation via
  kernel CIFS with systemd automount (`_private/nixos/filesystems.nix`): `/mnt/backups`
  (uid 1001/rae) and **`/home/jacob/cloud`** (uid 1000/jacob, SMB user `jacob-alford`) — the
  write target for Model B. Options: `x-systemd.automount,noauto,x-systemd.idle-timeout=60,
  x-systemd.device-timeout=5s,x-systemd.mount-timeout=5s` → mounts on first access, unmounts
  after 60s idle, fails fast on network split. Accessing the path from a user service is
  sufficient to trigger the mount.
- iOS/iPadOS can browse the same SMB share directly (Files app or SMB-capable client apps) — the
  distribution channel for the encrypted bundle. The p12 passphrase lives in sops, so it can be
  pulled up on demand when importing on a device (§3.3).
- Encrypted-at-rest-on-NAS precedent: restic repos under `/mnt/backups/<service>` (augustus).

### 1.5 iOS cert precedent

Apple devices already get **hardware-bound** client certs via the `eap` provisioner +
`com.apple.security.acme` mobileconfig profiles generated by homelab-api
(`packages/homelab-services-node/src/layers/acme-config-service.ts:26-51`; device serial → CN,
attestation format `apple`). Model B is complementary: a _shared portable_ identity for apps that
cannot use profile-installed keychain identities. The serial→user template mapping (§4.2) applies
to these Apple certs too — that's the EAP-TLS angle.

### 1.6 Caddy

Caddy **2.11.7** via `pkgs-unstable` (`services/caddy.nix:14-21`). Existing mTLS vhosts use
root-trust `client_auth` with `c.ca.rootCert`. The stock `leaf` verifier was evaluated and
**rejected** (§4.3); proxy-layer field validation would require a custom Caddy plugin (§4.3,
future work).

---

## 2. Model A — YubiKey-Attested Client Cert (HM, jacob@nixos)

### 2.1 How the flow works (source-verified)

Enrollment uses the ACME **`device-attest-01`** challenge with the **`step` attestation format**
against a provisioner that has it enabled (today: `eap`). Every hop verified in vendored source:

**CLI side (`repos/step-cli`):**

1. `step ca certificate <subject> <crt-file> --attestation-uri 'yubikey:...
   ?pin-source=...'` — with `--attestation-uri` the key-file argument is dropped (the key never
   exists as a file): `command/ca/certificate.go:226`; `--attestation-uri` and `--kms` are
   mutually exclusive (`:243-247`).
2. ACME flow selection: explicit `--acme <directory-url>` (`:256-260`), or automatic when the
   named provisioner is an ACME one — `GenerateToken` fails with `ACMETokenError` and the flow
   falls back to `ACMECreateCertFlow` (`:261-265`), deriving
   `<ca-url>/acme/<provisioner>/directory` (`utils/cautils/acmeutils.go:653-662`).
3. The ACME order carries a single identifier `{type: "permanent-identifier", value: <subject>}`;
   "We currently do not accept other SANs with attestation certificates"
   (`acmeutils.go:718-740`). The CSR is built with `CN = <subject>` and signed by the KMS key
   (`:797-806`).
4. The challenge response is produced by `cryptoutil.CreateAttestor("", <attestation-uri>)` →
   `attestor.Attest()` (`acmeutils.go:403-417`). `internal/cryptoutil` **shells out to
   `step-kms-plugin`** (found via PATH) for `key`, `sign`, and `attest` subcommands
   (`internal/cryptoutil/cryptoutil.go:170-174, 228-259, 345-361`).
5. `step-kms-plugin attest` → go.step.sm/crypto yubikey KMS `CreateAttestation()`: produces the
   PIV slot attestation certificate + Yubico intermediate chain ("Yubico PIV Attestation A 1"/
   "B 1", bundled in the library) and returns `PermanentIdentifier` = **YubiKey serial** read
   from the attestation cert (OID `1.3.6.1.4.1.41482.3.7`)
   (`repos/crypto/kms/yubikey/yubikey.go:39,84,451-495,683-690`).

**CA side (`repos/step-ca`, v0.29.0):**

6. `step` format handler: `acme/challenge.go:886-913` → `doStepAttestationFormat`
   (`:1433-1448`): verifies the `x5c` chain against configured attestation roots or the
   **embedded defaults — Yubico PIV Root CA + Yubico Attestation Root 1 (YubiKey 5.7.4+)**
   (`:1395-1416`). **No `attestationRoots` config is needed** for stock YubiKey 5 tokens.
7. Extracts the serial (OID above, `:1419-1421`) and **requires attested serial == order
   identifier** (`:903-910`) — so `<subject>` must be exactly the YubiKey serial, and only that
   physical token can obtain the cert.
8. Pins the CSR public key to the attested key via fingerprint (`:912-913`) — you cannot attest
   with the YubiKey and smuggle in a software key.
9. The issued cert then passes the authority x509 name policy like any other sign request →
   **the YubiKey serial must be allowed as a CN** (§2.2 step E) — same mechanism as the Apple
   serials. Serial-based CNs are the deliberate identity scheme for hardware tokens.

**Renewal (`repos/step-cli/command/ca/renew.go`):**

10. `step ca renew <crt-file> '<yubikey-uri>' --daemon` — the key argument accepts a KMS URI
    (`tlsLoadX509KeyPair` → `cryptoutil.CreateSigner`, `:656-670`; `--kms` flag also exists,
    `:245`). Renewal itself authenticates by **mTLS using the cert being renewed** (`:482-487`) —
    no provisioner credentials needed after enrollment.
11. Daemon timing: renews when 2/3 of validity has elapsed (default), jittered; `--expires-in` /
    `--renew-period` override (`:329-333, 354-380`).
12. **Failure behavior (important):** on renewal error the daemon returns
    `durationOnErrors = 1 * time.Minute` and keeps looping (`:549-556`) — it does **not** exit
    when the YubiKey is unplugged or the CA is unreachable; it retries every minute. systemd
    `Restart=` only needs to cover process crashes.

### 2.2 Enrollment runbook (one-time, YubiKey plugged in, interactive)

```sh
# A. Identify the token (record the serial — it becomes the cert subject/CN)
ykman list            # e.g. "YubiKey 5C NFC (5.4.3) [PIV+OATH+...] Serial: 12345678"
ykman info            # firmware: PIV attestation requires YubiKey 5 series

# B. PIN available as a file (steady state: HM sops secret, §2.4):
#    /run/user/1000/secrets/yk_client_pin
#    Enrollment additionally needs the PIV management key (one-time; store in sops):
PIN=/run/user/1000/secrets/yk_client_pin
MGMT=/run/user/1000/secrets/yk_mgmt_key      # Phase-0: confirm format expected by the plugin

# C. Generate a P-256 key in PIV slot 9a (PIV Authentication) — exact plugin invocation
#    confirmed in Phase 0 (`step-kms-plugin create --help`):
step-kms-plugin create "yubikey:slot-id=9a?serial=12345678&pin-source=$PIN&management-key-source=$MGMT"

# D. Issue the cert via device-attest-01. Subject MUST equal the YubiKey serial (CA check,
#    challenge.go:903). 720h is within the eap provisioner's 729h max:
step ca certificate 12345678 "$HOME/.local/share/step-client-cert/yk-12345678.crt" \
  --attestation-uri "yubikey:slot-id=9a?serial=12345678&pin-source=$PIN" \
  --acme https://ca.plato-splunk.media/acme/eap/directory \
  --root /etc/ssl/certs/alford-root.crt \
  --not-after 720h

# E. (Before step D succeeds) the serial must pass the CA x509 policy AND the provisioner
#    template's serial→user map (§4.2):
#    - add "12345678" to x509PermittedCommonNames in nix-config/modules/constants.nix:100-103
#    - add "12345678" = "<kanidm-user>" to the provisioner's templateData devices map
#    - rebuild cicero.

# F. Inspect + smoke-test mTLS (renewal itself is an mTLS call, so a successful renew proves it):
step certificate inspect "$HOME/.local/share/step-client-cert/yk-12345678.crt"
step ca renew "$HOME/.local/share/step-client-cert/yk-12345678.crt" \
  "yubikey:slot-id=9a?serial=12345678&pin-source=$PIN" \
  --ca-url https://ca.plato-splunk.media --root /etc/ssl/certs/alford-root.crt --force
```

> **Provisioner choice:** reusing `eap` requires zero CA changes (device-attest-01 + `step`
> format already enabled). A **dedicated `yk-client` ACME provisioner** (device-attest-01,
> `step` format only, own claims/template incl. the devices map + UUID extension) is recommended
> for separation from the Apple WiFi flow — see §8, Open #2. Whichever is used, the template
> gains the serial→user mapping (§4.2) so the cert carries OU = kanidm user.

### 2.3 Renewal service (HM user unit)

```nix
systemd.user.services.step-client-cert-yubikey = {
  Unit = {
    Description = "Keep the YubiKey PIV client certificate renewed (step-ca daemon)";
    After = [ "network-online.target" ];
  };
  Service = {
    ExecStart = ''
      ${lib.getExe cfg.package}/bin/step ca renew ${certPath} \
        'yubikey:slot-id=${cfg.slot}?serial=${cfg.serial}&pin-source=${pinPath}' \
        --daemon --ca-url ${c.ca.url} --root ${c.ca.rootCert}
    '';
    # step-kms-plugin must be on PATH (cryptoutil resolves it via plugin.LookPath):
    Environment = [ "PATH=${lib.makeBinPath [ pkgs.step-kms-plugin ]}:/run/wrappers/bin:/usr/bin:/bin" ];
    Restart = "on-failure";   # daemon self-retries every 1m on renewal errors (renew.go:550)
    RestartSec = 300;
  };
  Install = { WantedBy = [ "default.target" ]; };
};
```

- Lifetime math with `--not-after 720h` (30d): first renewal attempt ≈ day 20, hard expiry
  day 30 → **the YubiKey must be plugged into the workstation at some point during the 10-day
  window**. Miss it and the cert expires → re-run enrollment (renewal-after-expiry is off by
  default; enabling `allowRenewalAfterExpiry` on the provisioner is §8, Open #3).
- pcscd access from a lingering user service: replicate cicero's polkit rules
  (`_private/cicero/security.nix:9-21`) in `_private/nixos/security.nix`; verify headless in
  Phase 0 via `systemd-run --user`.
- `--exec` hook available if a local consumer needs a reload signal (not needed initially).

### 2.4 Module shape (home-manager)

New `flake.modules.homeManager.yubikey-client-cert` under
`nix-config/modules/features/yubikey-client-cert/` (options + complete split, following the
`features/nixvim` / `programs/git.nix` registration pattern):

```nix
services.yubikey-client-cert = {          # HM option namespace (name bikesheddable)
  enable = mkEnableOption "...";
  serial = mkOption types.str;            # YubiKey serial = cert subject/CN
  slot   = mkOption types.str;            # default "9a" (PIV Authentication)
  pinSecret = mkOption types.str;         # sops secret name in nixos.yaml (HM sops)
  certPath = mkOption types.path;         # default ~/.local/share/step-client-cert/yk-<serial>.crt
  acmeDirectory = mkOption types.str;     # default c.ca.url + "/acme/yk-client/directory" (or /acme/eap/...)
  notAfter = mkOption types.str;          # default "720h"
  package = mkOption types.package;       # default pkgs.step-cli; step-kms-plugin added to PATH + home.packages
};
```

- Secrets: new `yk_client_pin` + `yk_client_mgmt_key` in `nix-config/secrets/nixos.yaml`,
  declared in `home/jacob-nixos.nix` sops block (`:84-89` pattern) → runtime paths under
  `/run/user/1000/secrets/`.
- Packages added to `jacob@nixos`: `step-kms-plugin` (missing today, required by the CLI for all
  KMS/attestation operations).
- Enrollment stays a **manual runbook** (§2.2, mirrored in the `adding-client-certs` skill) — it
  needs physical presence + management key; the module only runs the renewal daemon.

### 2.5 Consumption on NixOS — honest limitations

The private key never leaves the PIV slot, so consumers must be PKCS#11/KMS-aware:

| Consumer                                                      | Works?                                                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| step ecosystem (`step ca renew` mTLS, `step-kms-plugin sign`) | ✅ today                                                                                 |
| `openssl s_client` / `curl` via engine                        | ⚠️ needs `opensc` + `pkcs11-provider` (+ engine glue) — not installed; optional follow-up |
| Firefox client certs                                          | ⚠️ needs opensc/p11-kit module registration — optional follow-up                          |
| nginx/Caddy/Go stdlib clients                                 | ❌ no PKCS#11 support                                                                    |

Model A's value is the **strong, hardware-rooted, serial-CN'd workstation identity** (attested
serial, non-exportable key). File-key consumers use Model B. If a specific NixOS service later
needs mTLS with Model A's cert, adding `opensc`/`pkcs11-provider` is a small, separable step.

---

## 3. Model B — Portable Per-Use Client Certs (reusable module)

### 3.1 Hand-coded per-use provisioners with authorization-stamping templates

**Every provisioner is hand-coded in `services/step-ca.nix`** — declarative, git-tracked, no
admin-API credentials anywhere, no CA DB state drift. (Dynamic provisioning via
`step ca provisioner add` was evaluated and **rejected** — §8, Decided #4. The admin bootstrap
state on cicero is uncertain anyway: the super-admin `"step"` + DB-managed first JWK provisioner
are only auto-created on the ca.json→DB migration path,
`repos/step-ca/authority/authority.go:674-702`.) The friction of "edit step-ca.nix + rebuild
cicero per new use" is compensated by the **`adding-client-certs` skill** (§3.6), which makes the
whole addition a followable checklist.

Each _use_ gets its own JWK provisioner `client-<use>` (same pattern as the four host JWKs,
`services/step-ca.nix:169-232`), carrying:

- **Custom x509 template + template data** — the CA stamps identity/authorization attributes
  server-side; the requesting client cannot forge or escalate them. Template data is exposed to
  templates as **`.User`** (`repos/crypto/x509util/templates.go:15` `UserKey = "User"`; wired
  from the provisioner at `repos/step-ca/authority/provisioners.go:497,768-769`). Provisioner
  `options.x509` accepts inline `template`, `templateFile`, and `templateData`
  (`repos/step-ca/authority/provisioner/options.go:80-87`) — all representable in the NixOS
  module's freeform `settings` attrset. Precedent: the `eap` provisioner's forced-CN/clientAuth
  template (`services/step-ca.nix:134-147`).
- **Per-use duration claims** (`minTLSCertDuration` / `defaultTLSCertDuration` /
  `maxTLSCertDuration` in the provisioner `claims`).
- Optionally `disableRenewal` / `allowRenewalAfterExpiry` per use.

**The per-provisioner UUID extension (the field verifiers check).** Templates support arbitrary
custom extensions: the x509util `Certificate` struct has `Extensions []Extension`
(`json:"extensions"`, `repos/crypto/x509util/certificate.go:30`) where

```go
type Extension struct {          // repos/crypto/x509util/extensions.go:253-258
    ID       ObjectIdentifier `json:"id"`       // dotted-string OID
    Critical bool             `json:"critical"`
    Value    []byte           `json:"value"`    // JSON []byte ⇒ base64 string
}
```

and `Extension.Set()` appends to `ExtraExtensions` (`:281-290`, wired at `certificate.go:77,250`).
So each provisioner's template emits **one fixed custom extension whose value is that
provisioner's UUID** — generated once (`uuidgen`), hard-coded in the provisioner's
`templateData`, unforgeable by clients:

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

(Nix can precompute `builtins.base64Encode uuid` into `templateData` instead of relying on
sprig's `b64enc` — either works; verify rendering in Phase 0.)

- **OID choice:** a namespace OID under the ISO **UUID-derived arc `2.25`** (e.g.
  `2.25.<decimal form of one homelab namespace UUID>`), declared once in `constants.nix` —
  legitimate without an IANA PEN registration. Registering a PEN
  (`1.3.6.1.4.1.<pen>.<n>`) is the alternative (§8, Open #1).
- Email-form subjects (`<use>@plato-splunk.media`) remain the CN — they pass the existing policy
  with zero changes — but the **UUID extension is the authoritative validation field**: email/CN
  only proves the holder of the provisioner JWK requested it, whereas the extension is
  template-controlled per provisioner and machine-matchable by any verifier (proxy or app)
  without DN parsing quirks.

Example Nix (sketch; full shape in the skill):

```nix
{
  type = "JWK";
  name = "client-mobile.${c.baseDomain}";
  key = { "use" = "sig"; "kty" = "EC"; "kid" = "..."; "crv" = "P-256"; "alg" = "ES256"; "x" = "..."; "y" = "..."; };
  claims = { "defaultTLSCertDuration" = "720h"; "maxTLSCertDuration" = "720h"; };
  options.x509 = {
    template = ''<the JSON template above>'';
    templateData = {
      uuid = "9f2c...-...";                  # uuidgen, once per provisioner
      certIdOid = c.ca.clientCertIdOid;      # 2.25.<namespace uuid decimal>
      owner = "jacob";                       # kanidm user
    };
  };
}
```

### 3.2 Issuance + renewal (module scripts)

Issuance reuses the proven `ssh-cert-renewer` token flow (`services/ssh-cert-renewer.nix:55-105`):

```sh
# issue.sh (oneshot, idempotent: skips if cert exists and not near expiry)
tok=$(step ca token "$SUBJECT" \
  --provisioner "client-$USE" --key "$JWK_PRIV" --password-file "$PROV_PW" \
  --ca-url https://ca.plato-splunk.media --root "$ROOT")
step ca certificate "$SUBJECT" "$STATE/cert.crt" "$STATE/key.pem" \
  --token "$tok" --password-file "$KEY_PW"      # key.pem written encrypted (step default)
"$PUBLISH_SH"
```

Renewal daemon (long-running service):

```sh
# renew.sh
step ca renew "$STATE/cert.crt" "$STATE/key.pem" \
  --password-file "$KEY_PW" \
  --daemon --exec "$PUBLISH_SH" \
  --ca-url https://ca.plato-splunk.media --root "$ROOT"
```

- Same retry semantics as Model A: daemon survives NAS/CA outages, retrying every minute
  (`renew.go:549-556`); renewal keeps subject/SANs/extensions identical (server re-renders the
  provisioner template), so policy/template gating happens once at issuance and on every renew.
- `--exec "$PUBLISH_SH"` runs after **each successful renewal** (`renew.go:328, 382-413`).

### 3.3 Encryption + publication to the NAS (all passphrases in sops)

Two encryption layers, both passphrase-based (iOS-compatible), **every passphrase a sops secret**
so it can be decrypted on demand (`sops -d nix-config/secrets/nixos.yaml` / `sops exec-file`)
when importing on an iOS device:

1. **At rest on the issuing host:** `key.pem` is a passphrase-encrypted PEM (step-native,
   `--password-file`); lives in the module state dir (`/var/lib/step-client-cert/<name>/` or a
   user-owned equivalent), mode 0600. Never published.
2. **Published bundle:** PKCS#12 via `step certificate p12 <out.p12> <crt> <key>
   --ca <root> --password-file <p12-pass>` (verified: `command/certificate/p12.go:73-85`; the
   `--legacy` flag exists for old-Apple PKCS#12 algorithm compatibility — decide during the
   iOS pilot, §8 Open #4). Includes the root CA so the bundle is self-contained.

Publish script (atomic; CIFS-safe):

```sh
# publish.sh — retries because the NAS may be asleep/unreachable (automount + idle-timeout)
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
step certificate p12 "$tmp/bundle.p12" "$STATE/cert.crt" "$STATE/key.pem" \
  --ca "$ROOT" --password-file "$P12_PW" ${LEGACY:+--legacy}
cp "$STATE/cert.crt" "$tmp/cert.crt"
for i in $(seq 10); do
  mkdir -p "$OUT_DIR" && mv -f "$tmp/bundle.p12" "$OUT_DIR/bundle.p12" \
    && mv -f "$tmp/cert.crt" "$OUT_DIR/cert.crt" && exit 0
  sleep 30
done
exit 1   # next renewal (or the publish timer, Open #5) retries
```

- First-use output location: `OUT_DIR=/home/jacob/cloud/certs/<use>/` (jacob's CIFS mount;
  writing to the path triggers the automount).

### 3.4 Module shape (NixOS, multi-instance)

`nix-config/modules/services/step-client-cert.nix` →
`flake.modules.nixos.step-client-cert`, option namespace `services.step-client-cert.<name>`
(attrset of instances, catalog-style):

```nix
services.step-client-cert.mobile = {
  enable = true;
  subject = "mobile@plato-splunk.media";
  provisioner = "client-mobile.plato-splunk.media";
  jwkPrivateKeyFile = config.sops.secrets.client_mobile_jwk.path;      # sops
  provisionerPasswordFile = config.sops.secrets.client_mobile_prov_pw.path;
  keyPasswordFile = config.sops.secrets.client_mobile_key_pw.path;
  p12PasswordFile = config.sops.secrets.client_mobile_p12_pw.path;
  publishPath = "/home/jacob/cloud/certs/mobile";   # nullable → no publish
  p12Legacy = false;
  user = "jacob";                                   # needs write access to publishPath
  renewPeriod = null;                               # default: 2/3-of-validity daemon timing
};
```

- Units per instance: `step-client-cert-<name>.service` (oneshot issue-if-missing) +
  `step-client-cert-<name>-renew.service` (long-running daemon, `Restart=on-failure`).
- Scripts built with `constants.shell.mkScript` (shellcheck-gated via
  `flake.lintedShellScripts`, `nix-config/modules/lib/shell.nix:37-43`).
- Runs on any host; the workstation instance writes to the NAS as `jacob`. (A `jacob@nixos`
  home-manager variant can wrap the same scripts later if preferred — §8, Open #6.)
- Package set: `step-cli` (no `step-kms-plugin` needed — software keys only).

### 3.5 iOS consumption

- Files app (or SMB-capable app) → `smb://nas.plato-splunk.media` (LAN) →
  `Personal-Drive/certs/<use>/bundle.p12` → import into the target app with the bundle
  passphrase (pulled from sops when needed; stored once in the app/iOS keychain).
- Apps that cache the imported identity need a **re-import after each renewal** — the per-use
  provisioner duration controls that cadence (720h default → ~monthly; tune per app tolerance).
- Bundle path/content are stable across renewals (`mv -f` overwrite), so SMB-shortcut–style
  consumers always see the current cert.
- Future: homelab-api endpoint that wraps the current bundle in a `.mobileconfig`
  (PKCS#12 payload) for one-tap install — precedent: `wifi-profile-generator.ts` /
  `acme-profile-generator.ts`.

### 3.6 Adding a new use — the `adding-client-certs` skill

Because provisioners are hand-coded, adding a use touches `step-ca.nix`, `constants.nix`
(maybe), sops secrets, and the consuming host. The full checklist — keypair generation
(`step crypto jwk create`), provisioner block with UUID + template, secret wiring, cicero
rebuild, issuance, verification, renewal wiring, and the YubiKey (Model A) enrollment variant —
lives in `.opencode/skills/adding-client-certs/SKILL.md` and should be kept in sync with this
plan as implementation lands.

---

## 4. Authorization: Locking Per-Use Identities Down

Layered enforcement, outermost first — each layer independently constrains what a cert can do.
The identity anchor throughout is the **kanidm user** (§4.5).

### 4.1 CA name policy (exists)

`services/step-ca.nix:55-75` — only declared identities can be issued at all: per-use email
subjects (`<use>@plato-splunk.media`) under the existing `allow.email`, or hardware serials
(Apple/YubiKey) allowlisted in `x509PermittedCommonNames`. Enforced on sign **and** renew
(`repos/step-ca/authority/provisioner/jwk.go:210`).

### 4.2 Provisioner templates — UUID extension + serial→user map

The CA — not the client — decides every authorization-relevant cert field from the provisioner's
template + `.User` data (§3.1):

1. **Per-provisioner UUID custom extension** (§3.1) — the authoritative "which use is this cert
   for" field, machine-matchable by any verifier. A leaked provisioner JWK cannot mint a cert
   with a different UUID; it can only mint certs _for that use_.
2. **Serial→kanidm-user string map** for hardware-serial identities (Apple devices, YubiKeys):
   `templateData.devices = { "G1447DK9FP" = "jacob"; "12345678" = "jacob"; ... }`, and the
   template stamps `organizationalUnit = index .User.devices <CN>` **failing closed** on unknown
   serials (`{{ if not $u }}{{ fail "unknown device serial" }}{{ end }}` — sprig `fail`; verify
   rendering in Phase 0). The map thus doubles as an issuance allowlist _inside_ the template,
   on top of the name policy (§4.1) — two independent Nix-declarative gates.
   - This is the EAP-TLS-relevant piece: certs carry `CN=<serial>` + `OU=<kanidm user>`, so
     RADIUS/wifi matching and any future verifier can bind a hardware device to its owner.
     Existing precedent for serial maps in config: the IP→serial sops template feeding
     homelab-api's `SerialNumberConfig` (`docs/eap-tls-prerequisites.md` §3).
   - Apply the same map+OU stamping to the `eap` provisioner template (Apple certs) and the
     Model A provisioner (`eap` reuse or dedicated `yk-client`) — one shared `devices` map in
     `constants.nix` consumed by all three templates.
3. `clientAuth`-only EKU + forced subject fields — certs can't masquerade as server certs.

### 4.3 Proxy-layer validation — leaf verifier rejected; custom extension later

The stock Caddy `leaf` verifier was evaluated and **rejected**: it is an _exact allowlist of
whole certificates_ (file/folder/pem loaders) that runs after `trust_pool` chain validation —
not a CN/extension matcher. With auto-renewing certs it would couple every renewal to a
folder re-publish + Caddy reload, and it still wouldn't express "accept any cert with
UUID X" semantics. **Do not use it.**

The forward path for proxy-layer validation is a **custom Caddy client-cert verifier module**
(`tls.client_auth.verifier` namespace) that extracts our custom OID extension (and/or OU) from
the presented leaf and compares against per-site config — exactly the field §4.2 makes
available. Feasibility notes for a future spike: Caddy plugins require an xcaddy-style build
(nixpkgs `caddy` with `buildGoModule` + plugin overlay); the verifier interface is small
(runs post-chain-validation). Until then, proxy layers do chain-trust only
(`trust_pool` = `alford-root.crt`) and enforcement lives at §4.2 + §4.4.

### 4.4 App-layer validation (homelab-api)

`MTLSIdentity` (`packages/homelab-services/src/identity.ts:97-119`) already models
`commonName → permissionSet (scopes)`, currently exercised only in tests. Wiring plan: at the
API edge, parse the client cert's **UUID extension** (authoritative use match) + **OU** (owning
kanidm user) and map to scope sets — that is the ReBAC-style lockdown, keyed on fields the CA
guarantees. Richer relations later: stamp URI SANs (URN relation tuples) via provisioner
templates and extend `MTLSIdentity` to read them. Note x509util also supports the RFC 4043
`PermanentIdentifier` otherName SAN (`repos/crypto/x509util/extensions.go:145-208`) — useful if
device certs should carry the hardware serial as a machine-readable extension too.

### 4.5 Kanidm alignment — unix auth, admin accounts (related workstreams)

Kanidm is the single authorization anchor across all auth surfaces:

| Surface                   | Mechanism (today)                                                                                                                                                                               | Client-cert tie-in                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| SSH login                 | step-ca OIDC `kanidm` provisioner → 2h user certs (`ssh proxycommand`, `home/jacob-nixos.nix:561-591`)                                                                                          | none needed                                      |
| WiFi EAP-TLS              | `eap` provisioner device-attest certs + freeradius/kanidm (`features/radius/`, `docs/eap-tls-prerequisites.md`)                                                                                 | serial→user map (§4.2) binds cert to kanidm user |
| mTLS apps                 | this plan: UUID extension + OU=kanidm user → `MTLSIdentity` scopes                                                                                                                              | direct                                           |
| Unix login/sudo (PAM/NSS) | **kanidm-unix — not yet adopted/verified** (`docs/kanidm-unix-users-plan.md`, `docs/kanidm-nixos-users-preplan.md`; `features/kanidm-client/service.nix` SSH integration deliberately disabled) | see below                                        |

Honest assessment for the kanidm-unix question: **client certs cannot directly feed PAM/NSS** —
kanidm-unix auth is password/WebAuthn (PAM) plus SSH certs (kanidm's own SSH CA, which this repo
doesn't use — step-ca's OIDC flow is the SSH path). What client certs _do_ offer is **identity
alignment**: the same kanidm user appears as SSH cert principal, EAP-TLS OU, and mTLS OU/UUID
owner, so group membership in kanidm stays the one knob that governs everything. Possible future
simplification: derive the `devices` serial→user map (and even per-use provisioner ownership)
from kanidm data (script or step-ca webhook) instead of hand-maintaining it in Nix (§8, Open #9).

**Admin account lockdown (augustus + cicero):** standardize on a dedicated kanidm-managed admin
identity (rather than the personal `jacob` account holding sudo everywhere), gated by kanidm
group membership, reaching hosts via the existing step-ca OIDC SSH-cert path and granting sudo
through kanidm-unix sudo rules or NixOS `security.sudo` config. This interacts with this plan
only through shared kanidm groups/users; it is **tracked separately** alongside the kanidm-unix
adoption TODO (§8, Open #11) — verify kanidm-unix works end-to-end first, then design the admin
account in `docs/kanidm-unix-users-plan.md`'s successor.

---

## 5. Files to Create / Modify

| #  | File                                                                             | Action                                                                                                                                              | Model |
| -- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1  | `nix-config/modules/features/yubikey-client-cert/{options,complete}.nix`         | create HM module `homeManager.yubikey-client-cert`                                                                                                  | A     |
| 2  | `nix-config/modules/home/jacob-nixos.nix`                                        | import module; instance config; sops secrets decl; add `step-kms-plugin` to `home.packages`                                                         | A     |
| 3  | `nix-config/secrets/nixos.yaml`                                                  | add `yk_client_pin`, `yk_client_mgmt_key`, `client_<use>_{jwk,prov_pw,key_pw,p12_pw}` via `sops`                                                    | A+B   |
| 4  | `nix-config/modules/constants.nix`                                               | YubiKey serial → `x509PermittedCommonNames` (`:100-103`); shared `devices` serial→user map; `ca.clientCertIdOid` (2.25-arc namespace OID)           | A+B   |
| 5  | `nix-config/modules/_private/nixos/security.nix`                                 | polkit pcsc-lite rules for lingering user service (cicero precedent `:9-21`)                                                                        | A     |
| 6  | `nix-config/modules/services/step-ca.nix`                                        | `yk-client` ACME provisioner (or `eap` template update) + hand-coded `client-<use>` JWK provisioners: UUID extension, `devices` map, per-use claims | A+B   |
| 7  | `nix-config/modules/services/step-client-cert.nix`                               | create multi-instance NixOS module + `mkScript` scripts (issue/renew/publish)                                                                       | B     |
| 8  | `nix-config/modules/_private/nixos/*.nix`                                        | wire first Model B instance (`mobile`, `user = "jacob"`, publish → `/home/jacob/cloud/certs/mobile`)                                                | B     |
| 9  | `nix-config/modules/features/acme-client-cert/`, `services/acme-client-cert.nix` | delete vestigial skeleton (§8 Decided #10)                                                                                                          | —     |
| 10 | `.opencode/skills/adding-client-certs/SKILL.md`                                  | **created 2026-11-02** — hand-coded provisioner + client-cert workflow checklist; keep in sync as modules land                                      | A+B   |
| 11 | `AGENTS.md` skill index                                                          | add `adding-client-certs` row (**done 2026-11-02**)                                                                                                 | —     |
| 12 | `packages/homelab-services/src/identity.ts` (+ node layers)                      | MTLSIdentity: validate UUID extension + OU → scopes (Phase 3)                                                                                       | B     |
| 13 | `docs/port-assignments.md`                                                       | **no change** (no new ports)                                                                                                                        | —     |

---

## 6. Implementation Order

### Phase 0 — spike (YubiKey plugged in; no permanent Nix changes)

- [ ] `ykman list` / `ykman info` — pick the token, record serial, confirm firmware 5.x
- [ ] `nix shell nixpkgs#step-kms-plugin` → confirm `create` / `attest` subcommand syntax for
      `yubikey:` URIs (incl. `management-key-source` format) — the plugin is not vendored; record
      findings back into this doc + the skill
- [ ] `step-kms-plugin create 'yubikey:slot-id=9a?...'` — generate the slot key
- [ ] **Template rendering sandbox:** throwaway `step ca init` CA (software keys) with the UUID
      extension + `devices` map template; confirm via `step certificate inspect` that the custom
      OID renders with the right base64 value, OU stamps correctly, and an unknown serial fails
      closed (sprig `fail`)
- [ ] Add serial to `x509PermittedCommonNames` + `devices` map, rebuild cicero, run §2.2
      enrollment end-to-end
- [ ] `step ca renew` once manually; then `--daemon` briefly; **unplug the key mid-run** and
      confirm the 1-minute retry behavior (`renew.go:550`) and clean recovery on replug
- [ ] Verify pcsc access from a headless user unit: `systemd-run --user ... step-kms-plugin key
      'yubikey:...'`; add polkit rules if it fails
- [ ] Model B dry run (software key, one hand-coded `client-test` provisioner): issue → renew →
      `step certificate p12` → import on iPhone/iPad; settle `--legacy` question (§8#4)

### Phase 1 — Model A module

- [ ] Files #1–#5 (+ #6 `yk-client` provisioner); `git add` before `nix eval`
- [ ] `home-manager switch --flake .#jacob@nixos`; service active; renewal observed in logs
- [ ] Failure-notifs consideration: user units aren't covered by the system failure-notifs stack —
      decide whether to add `OnFailure=` plumbing (Open #7)

### Phase 2 — Model B module + first use (`mobile` → NAS)

- [ ] `client-mobile` provisioner hand-coded per the skill (UUID, owner, claims)
- [ ] sops secrets added (jwk priv, provisioner pw, key pw, p12 pw)
- [ ] File #7 module + scripts; shellcheck gate passes
- [ ] File #8 instance on nixos as `jacob`; bundle appears at
      `/home/jacob/cloud/certs/mobile/bundle.p12`; survives a renewal cycle
- [ ] iOS import verified against a real mTLS endpoint
- [ ] Walk the `adding-client-certs` skill end-to-end as the validation of the skill itself;
      fix drift

### Phase 3 — enforcement layer

- [ ] homelab-api MTLSIdentity wiring: UUID-extension + OU → scopes for one protected surface
- [ ] Apply `devices` map + OU stamping to the `eap` provisioner template (Apple certs)
- [ ] (Optional) opensc/pkcs11-provider on the workstation for PKCS#11 consumers of Model A
- [ ] (Spike, optional) custom Caddy verifier plugin prototype (§4.3)

### Phase 4 — related workstreams (separate plans)

- [ ] Verify kanidm-unix (PAM/NSS) end-to-end; adopt or close out
      (`docs/kanidm-unix-users-plan.md`)
- [ ] Standardized kanidm-managed admin account lockdown for augustus + cicero (§4.5)

---

## 7. Validation

```sh
# Nix (git add new .nix files first — flake evaluates the git tree)
nix eval '.#homeConfigurations."jacob@nixos".config.systemd.user.services.step-client-cert-yubikey.Unit' --json
nix eval '.#nixosConfigurations.nixos.config.services.step-client-cert' --json
nix eval '.#nixosConfigurations.cicero.config.services.step-ca.settings.authority.provisioners' --json | jq '.[].name'
nix build .#checks.x86_64-linux.shellcheck
nixos-rebuild build --flake .#nixos && nixos-rebuild build --flake .#cicero
home-manager build --flake .#jacob@nixos

# Cert behavior
step certificate inspect <crt>            # CN, OU=<kanidm user>, EKU=clientAuth, custom OID w/ UUID value
openssl x509 -in <crt> -noout -text | grep -A1 '2\.25\.'   # UUID extension raw bytes
step certificate verify --roots certs/alford-root.crt <crt>
step ca renew <crt> <key-or-yubikey-uri> --force           # mTLS proof + renewal path
openssl s_client -connect <mtls-vhost>:443 -cert cert.crt -key <(decrypt key.pem)   # Model B e2e

# Repo gates
yarn lint && yarn typecheck && yarn test   # only when Phase 3 touches packages/
```

---

## 8. Decisions & Open Questions

### Decided

1. **Both models get built** — hardware-bound YubiKey identity for NixOS (Model A); portable
   encrypted per-use certs for NAS/iOS/anywhere (Model B). Forced by private-key exportability:
   mTLS needs the key, PIV keys don't leave the token.
2. **Model A issuance path** — ACME `device-attest-01` + `step` attestation format (the "device
   challenge"), subject = YubiKey serial, verified end-to-end in vendored source (§2.1). No
   `attestationRoots` needed (Yubico roots embedded, `challenge.go:1395-1448`).
3. **Renewal via `step ca renew --daemon`** for both models — self-retrying (1m) on failure,
   `--exec` publish hook for Model B.
4. **Hand-coded JWK provisioners only.** Dynamic provisioning via the admin API is rejected:
   admin-bootstrap state on cicero is uncertain (`authority.go:674-702`), DB-managed provisioners
   drift outside git, and it would put CA-admin credentials on the workstation. Compensation:
   the **`adding-client-certs` skill** turns each addition into a checklist.
5. **Per-provisioner UUID as a custom x509 extension** (template-stamped, base64 value, OID under
   the `2.25` UUID arc declared in `constants.nix`) is the authoritative validation field for
   proxy/app-layer checks. Email-form CNs stay for policy compatibility but are not the check
   field — possession of the provisioner JWK is all an email CN proves.
6. **Serial-keyed identities (Apple + YubiKey) stay**, with a **serial→kanidm-user `devices` map
   in provisioner `templateData`**: stamps `OU=<user>`, fails closed on unknown serials
   (template-level allowlist on top of the CA name policy). This is the control point for
   EAP-TLS and future verifiers; kanidm users/groups remain the authorization anchor.
7. **No Caddy `leaf` verifier** — exact-cert-allowlist semantics don't fit auto-renewing certs;
   proxy-layer field validation is deferred to a possible custom Caddy verifier plugin (§4.3).
8. **All encryption passphrases live in sops** (cert-key password, p12 passphrase) — decryptable
   on demand for iOS import; no 1Password-only secrets in this flow.
9. **Bundle format: passphrase-protected PKCS#12** including the root CA (`--ca`), atomic publish
   to `/home/jacob/cloud/certs/<use>/`.

### Open

1. **Custom-extension OID**: `2.25.<namespace-uuid>` (recommended, zero bureaucracy) vs
   registering an IANA PEN (`1.3.6.1.4.1.<pen>.<n>`). Also settle value encoding — raw UTF-8
   UUID bytes (recommended; trivial for verifiers) vs DER UTF8String wrapper.
2. **Model A provisioner: reuse `eap` or add dedicated `yk-client`?** Reuse = zero CA changes;
   dedicated = isolation from the Apple WiFi flow, own claims/template. _Lean: dedicated,
   hand-coded like everything else._ The `devices` map + UUID extension apply either way.
3. **Model A duration/absence tradeoff.** 720h + 2/3-renewal ⇒ key must appear during a 10-day
   window; expiry ⇒ manual re-enrollment. Alternatives: shorter duration (tighter), or
   `allowRenewalAfterExpiry` on the provisioner (grace without re-attestation — weakens the
   hardware-presence property).
4. **p12 `--legacy` flag** — modern step p12 uses AES-CBC/PBKDF2; some older Apple import paths
   want PBE+SHA1+3DES. Settle during the Phase 0 iOS import test.
5. **Publish robustness** — `--exec` retry loop (§3.3) may be enough; alternative is a separate
   hourly publish-sync timer comparing state dir vs NAS. Also: does a failed `--exec` warrant
   alerting (§ Open #7)?
6. **Model B packaging** — system module with `User=jacob` for the NAS instance vs a
   home-manager variant reusing the same scripts. _Lean: system module first._
7. **Monitoring** — system failure-notifs (Pushover) don't cover user units or self-retrying
   daemons. Worth a healthcheck (prometheus textfile of cert expiry per instance, or
   failure-notifs wiring for Model B system services)?
8. **Which YubiKey** is the workstation identity token (yk1/yk3 are FIDO2-SSH today; YK2 is the
   CA key on cicero) — and slot choice: `9a` (standard PIV Authentication) vs a retired slot to
   avoid future collisions.
9. **`devices` map maintenance** — hand-maintained Nix attrset in `constants.nix` to start;
   later possibly derived from kanidm (script or step-ca webhook enriching template data).
10. **Vestigial skeleton** — delete `features/acme-client-cert/` + `services/acme-client-cert.nix`
    in the Model A PR? _Lean: yes._
11. **kanidm-unix adoption + standardized admin account** (augustus/cicero) — user TODO to
    verify kanidm-unix works; then a separate plan for the admin-account lockdown (§4.5).
    Interacts here only via shared kanidm users/groups.

---

## 9. Expected Outcome

```
Model A (hardware-bound, workstation):
  YubiKey PIV 9a ──(serial + PIN)──▶ step ca certificate --attestation-uri yubikey:...
      ──▶ ACME device-attest-01 @ eap|yk-client provisioner ("step" format)
      ──▶ CA: verify Yubico chain + serial==identifier + CSR-key fingerprint
              + name policy + devices-map (fail closed) ──▶ CN=<serial>, OU=<kanidm user>
      ──▶ yk-<serial>.crt on workstation; key never leaves the token
  HM user service: step ca renew <crt> 'yubikey:...' --daemon   (retries 1m on failure)

Model B (portable, per-use, hand-coded provisioners):
  sops secrets ──▶ step ca token (client-<use> JWK provisioner)
      ──▶ template stamps: CN=<use>@…, OU=<kanidm user>, custom OID ext = <provisioner UUID>
      ──▶ cert.crt + encrypted key.pem in state dir
  step ca renew --daemon --exec publish.sh
      ──▶ bundle.p12 (sops passphrase, root included) ──atomic──▶ /home/jacob/cloud/certs/<use>/
      ──▶ iOS Files/SMB import · NixOS services consume PEM
  Lockdown: CA policy ▸ template (UUID + devices map) ▸ MTLSIdentity UUID/OU→scopes
            ▸ [future: custom Caddy verifier plugin]
  Anchor: kanidm users/groups ── SSH (OIDC certs) · EAP-TLS (OU) · mTLS (OU/UUID) · [unix: TODO]
```

Both models: certificates continuously valid with no manual intervention (Model A tolerates the
YubiKey being away for weeks; Model B tolerates NAS/CA outages), every identity scoped to its use
at issuance time by the CA itself, one encrypted self-refreshing pickup point per use on the NAS,
and a single skill-driven checklist for adding the next one.
