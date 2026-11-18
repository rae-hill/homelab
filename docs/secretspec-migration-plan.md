# SecretSpec Migration Plan

> Status: **Phases 1–2 COMPLETE** — declaration layer live (all sops files
> module-local; `secretspec check` resolves 60/60 secrets across the 6 host
> profiles); dev/e2e run on generated ephemeral secrets (repo-root
> `secretspec.toml`, commit `3c1ae71d15`). **Phase 3 SCOPED** (§4.3 + §7:
> exec-wrapper delivery — renderer design dropped); waves 3a–3e actionable,
> 3f gated on §9 Q1. Vendor research against `repos/secretspec` @ v0.21.1
> (= nixpkgs-unstable pin; nixpkgs-26.05 carries a stale 0.10.1).

## 1. Goals

1. Move secrets **declaration** into `secretspec.toml` files that live alongside
   the Nix module of the service that consumes them (not alongside the host).
2. Migrate secret **storage** from SOPS-encrypted yaml in git to 1Password
   service accounts, service by service, with SOPS as the interim provider.
3. Improve developer/e2e secrets: on-demand generation of ephemeral values
   instead of `scripts/stage-e2e-secrets.mjs` hand-rolling randomness.
4. Keep every host bootable and every secret path stable at each step.

## 2. What SecretSpec actually is (v0.21.1 research)

SecretSpec separates secret _declaration_ (`secretspec.toml`, committed) from
secret _storage_ (providers: 1Password, SOPS, age, keyring, env, null, file,
systemd-credential, ~30 total). It resolves declared secrets through a provider
**fallback chain** and injects them into a child process env
(`secretspec run -- cmd`), exports them (`export --format json|shell|dotenv`),
or hands them to SDKs. Values never enter the manifest; access is audit-logged
locally; `require_reason = "agents"` (default) forces AI agents to state a
reason before resolving secrets.

Key mechanics we rely on (verified in vendored source, not just docs):

| Feature                                            | Version           | Notes                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extends` inheritance                              | ✓                 | Child specs replace parent secrets wholesale; `[providers]`/`[scopes]` tables **merge** (child wins per key); paths relative to containing file (`config.rs overlay_with`)                                                                                                                      |
| Per-secret `providers` chain                       | ✓                 | Tried in order until found — the migration workhorse (`["op_host", "sops_kanidm"]`)                                                                                                                                                                                                             |
| `[profiles.<p>.defaults]` / `[defaults]` providers | ✓ / 0.21+         | Chain precedence: secret → profile → project → user-global                                                                                                                                                                                                                                      |
| `scopes`                                           | 0.17+             | Membership subsets; `run --scope X` scrubs every other manifest secret from the child env; composed inputs resolve invisibly                                                                                                                                                                    |
| `sops` provider                                    | 0.17+             | Read+write through the `sops` CLI; relative URIs resolve against the manifest dir; discovers `.sops.yaml` from manifest ancestors; age key via normal SOPS env/config                                                                                                                           |
| `onepassword` provider                             | ✓                 | Desktop app (dev), **service-account token** (hosts) via provider credential or `OP_SERVICE_ACCOUNT_TOKEN` env; `onepassword+token://Vault`; convention storage = Secure Note `secretspec/{project}/{profile}/{key}`; `ref = { item, field, vault, section }` addresses existing items in place |
| `import [PROVIDER] [--delete-source]`              | 0.18+             | Copies _missing_ values into the configured chain, never overwrites; `--delete-source` moves verified values — the sops→1Password mover                                                                                                                                                         |
| `generate` + types                                 | 0.7+ / keys 0.21+ | `password`/`hex`/`base64`/`uuid`/`command`/`rsa_private_key`/`openpgp_private_key`/`ssh_private_key`; only generates when missing; `null` provider = fresh value per resolution, never stored                                                                                                   |
| `composed`                                         | 0.16+             | Read-only `${UPPERCASE}` interpolation of declared secrets (DSNs etc.); static strings only                                                                                                                                                                                                     |
| `as_path`                                          | ✓                 | Value → temp file, env gets the path; CLI files persist; exact bytes 0.21+                                                                                                                                                                                                                      |
| `encoding` / `extract`                             | 0.19+             | base64/hex for binary-through-text providers; JSON-pointer/INI extraction                                                                                                                                                                                                                       |
| `export --format json --scope S`                   | ✓                 | One JSON object of name→value; as_path secrets export PATHS and their temp files PERSIST (no child-lifetime cleanup) — units use `run` instead                                                                                                                                                  |
| `systemd-credential` provider                      | 0.17+             | Read-only, from `$CREDENTIALS_DIRECTORY` — the SA-token bootstrap reader                                                                                                                                                                                                                        |
| Audit log                                          | ✓                 | Local JSONL, value-free, records scope/profile/reason/provenance                                                                                                                                                                                                                                |

### The critical gap

`nixos.md` in the repo is a **design proposal** (reconcile engine, systemd
encrypted-credential destination, `/run/secretspec` runtime-file destination,
controller-push). As of v0.21.1 **none of it has shipped**: no `reconcile`
command, no NixOS module, no flake outputs, no HM/nix-darwin integration. The
doc itself says SecretSpec "should not reimplement age or SOPS" and that users
wanting encrypted-files-in-git should keep sops-nix, and it warns: _do not wrap
consumers with `secretspec run`_ for system services.

**Consequence:** SecretSpec cannot replace sops-nix's runtime delivery role
(materializing `/run/secrets/<name>` files with owner/group/mode at activation,
rendering templates, restart coordination) out of the box. The plan therefore
pairs SecretSpec (declaration + resolution) with **thin self-built exec
wrappers** (§4.3) for delivery — `run`/`as_path` cover env/file-native
services; renderer-shaped cases (templates, activation-time consumers) stay
sops-nix until upstream reconcile ships.

## 3. Current state (post-split inventory)

Delivery today is sops-nix: secrets → `/run/secrets/<name>` (0400, owner/group),
templates → `/run/secrets/rendered/<name>`. 23 files under
`nix-config/secrets/<host>/`:

| Host        | File           | Secrets (count)      | Delivery style             | 1Password candidate?                   |
| ----------- | -------------- | -------------------- | -------------------------- | -------------------------------------- |
| augustus    | kanidm         | 3 (+1 template)      | files + restic template    | yes                                    |
| augustus    | postgres       | 1 (+1 template)      | restic template            | yes                                    |
| augustus    | openwebui      | 3 (+env template)    | env-file template          | yes                                    |
| augustus    | home-assistant | 3 (+yaml template)   | secrets.yaml template      | yes                                    |
| augustus    | radius         | 2 (+config template) | radius_config template     | yes                                    |
| augustus    | smb            | 1 (+creds template)  | mount credentials file     | yes                                    |
| augustus    | planka         | 5 (+1 template)      | files + template           | yes                                    |
| augustus    | step-ca        | 3 (1 dead)           | file (kanidm OIDC)         | yes (oidc), **no** (jwk — lifeline)    |
| augustus    | homelab-api    | 5 (+2 templates)     | files + env + serials JSON | yes                                    |
| augustus    | habitsync      | 3 (+env template)    | files + env template       | yes                                    |
| augustus    | failure-notifs | 2                    | files (pushover)           | yes — **pilot**                        |
| augustus    | grafana        | 4 (+1 template)      | ini refs + template        | yes                                    |
| augustus    | technitium     | 3                    | files                      | yes                                    |
| augustus    | unpoller       | 1                    | file:// in config          | yes                                    |
| augustus    | minecraft      | 1                    | restic file                | yes                                    |
| aedilis     | technitium     | 6                    | files                      | **lifeline — keep local** (public DNS) |
| aedilis     | step-ca        | 1                    | file                       | **lifeline — keep local**              |
| cicero      | step-ca        | 3 (+yk-pin template) | files + template           | **lifeline — keep local** (CA!)        |
| nixos       | smb            | 2 (+2 templates)     | mount credentials          | yes                                    |
| nixos       | step-ca        | 1                    | file                       | keep local (workstation offline)       |
| nixos       | opencode       | 2 (HM)               | HM user files              | yes (personal vault)                   |
| praeconinus | homelab-api    | 1 (+env template)    | file + template            | optional (VPS; keep local acceptable)  |
| mini        | openclaw       | 5 (darwin)           | files → wrapper env        | yes                                    |

"Lifeline" = a secret whose host must keep working when external SaaS is down
(CA, public DNS, SSH cert renewal). Classification policy in §6.

## 4. Target architecture

### 4.1 Declaration layout (as implemented in Phase 1)

```
nix-config/
├── secretspec.toml                  # ROOT manifest — PURE COMPOSITION: extends
│                                    #   every parent, binds the host_op_* (1Password)
│                                    #   placeholders, carries fleet conventions
├── modules/<category>/<module>/
│   └── secretspec.toml              # PARENT spec per service module: declares the
│                                    #   module's secrets in [profiles.<host>] (one
│                                    #   block per host that runs it), binds its own
│                                    #   sops_* alias(es), defines [scopes.<module>]
└── system-configs/<host>/
    └── secretspec.toml              # PARENT spec for host-specific secrets (the
                                     #   ones host-* Nix modules declare): profiles,
                                     #   aliases, host-qualified scopes. Only hosts
                                     #   that HAVE such secrets get one (augustus,
                                     #   nixos, aedilis).
```

**Every secret is declared exactly once, beside the Nix module that consumes
it**; the root only composes. Two hard constraints shaped this (both verified
empirically against secretspec 0.21.1):

1. **Alias paths are spelled relative to the ROOT manifest's directory.**
   Relative `sops://` URIs are rebased against the loaded root manifest's dir
   (`provider.with_base_dir(&config_dir)`), regardless of which parent defines
   the alias — and multi-level `../` paths break URL dot-segment normalization
   (one level up works, two fail in every URI form: `//`, opaque, and
   percent-encoded). Hence: root lives at `nix-config/` where every file is
   reachable forward-relative (`modules/...`, `system-configs/...`), and
   parents spell their alias paths from there. The coupling is documented in
   every spec header.
2. **Validation is per-document**: every `secretspec.toml` in the extends
   graph must declare the `profiles` field, and each profile _section it
   declares_ must contain ≥1 secret. An empty `[profiles]` table satisfies the
   field requirement — which is what lets the root stay declaration-free
   (this is also why `shared-secrets/` as an empty anchor parent was
   impossible; conventions live in the root's comments instead).

Design decisions (all verified with `secretspec check`):

- Profile = host name. Module parents declare `[profiles.<host>]` blocks —
  never `[profiles.default]` — so a profile resolves exactly the secrets of
  the services its host runs. Profiles, `[providers]`, and `[scopes]` tables
  merge across `extends` (per-key replacement, later document wins).
- **Names are lowercase, matching the sops yaml keys verbatim**: the sops
  provider's lookup is `[project, profile, key] → [profile, key] → [key]`,
  case-sensitive; lowercase names hit the flat `[key]` path with **no `ref`
  mapping needed**. (`composed` secrets' `${UPPERCASE}` restriction only
  affects composed references, which the wrapper glue replaces anyway.)
- `host_op_<host>` (the per-host 1Password SA alias) is bound ONLY by the
  root — it is host-scoped, path-free, and flips from `"null://"` to
  `onepassword+token://homelab-<host>` in Phase 4. A null provider mid-chain
  returns "missing" and resolution falls through to the sops alias (verified)
  — which is what makes the interim state work with zero behavioral change.
- Multi-host modules bind one sops alias per host file (`sops_renewer_cicero`
  …) and give each host profile its own chain; lifeline services (§6) simply
  have no `host_op` entry in their chain.
- **Scope naming rule**: module scopes are module-unique (`kanidm`, `planka`,
  …); host-parent scopes are host-qualified (`smb-augustus`, `smb-nixos`,
  `technitium-aedilis`, …) because same-named scopes in different documents
  REPLACE rather than union.

Root manifest (full file: `nix-config/secretspec.toml`):

```toml
[project]
name = "homelab"
revision = "1.0"
require_reason = "agents"
extends = ["modules/identity/identity-kanidm", "...", "system-configs/augustus"]

[providers]
host_op_augustus = "null://" # Phase 4: "onepassword+token://homelab-augustus"

[profiles] # empty table: keeps the document valid; content comes from parents
```

Module parent sketch (`modules/identity/identity-kanidm/secretspec.toml`):

```toml
[project]
name = "kanidm"
revision = "1.0"

[providers]
sops_kanidm = "sops://modules/identity/identity-kanidm/secrets/augustus.yaml" # root-relative!

[profiles.augustus]
kanidm_admin_passphrase = { description = "...", providers = ["host_op_augustus", "sops_kanidm"] }

[scopes.kanidm]
secrets = ["kanidm_admin_passphrase", "..."]
```

**Phase 1 acceptance (verified):** `secretspec check` resolves **60/60
secrets across the 6 host profiles** (augustus 39, nixos 5, cicero 3, aedilis
7, praeconinus 1, mini 5 — dead keys excluded) and all **27 scopes** (16
module + 7 host + 4 cross-host renewer/api re-checks) return their exact
expected sets through the sops provider, with `null://` standing in for
1Password. Run via the devshell: `secrets-check <host> [--scope <svc>]`.

### 4.2 Where the interim SOPS yamls live

**Decision: module-local.** The encrypted yaml moves next to the module that
consumes it, under a uniform `secrets/<host>.yaml` name:

| Case                                                               | Location                                                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Single-host service (kanidm, planka, openwebui, …)                 | `modules/<cat>/<module>/secrets/<host>.yaml`                                                                 |
| Multi-host service (homelab-api, ssh-cert-renewer)                 | same pattern, one file per host value set: `modules/homelab/homelab-api/secrets/{augustus,praeconinus}.yaml` |
| Host-specific secrets (smb, pushover, serials, aedilis technitium) | `system-configs/<host>/secrets/<service>.yaml` — beside the `host-*` module that declares them               |
| File-shaped modules (`homelab-ssh-cert-renewer.nix`)               | promote to a directory module, or park the file under `shared-secrets/` (decide in Phase 1)                  |

Rationale:

- **Cohesion**: `secretspec.toml`, the Nix module, and the encrypted values
  live together; deleting a service deletes everything. Same philosophy as
  `users-system`.
- **Clean sops URIs**: the sops provider resolves relative paths against the
  manifest directory (`provider/sops/config.rs rebase_path`), so a co-located
  file is `sops://secrets/augustus.yaml` rather than
  `sops://../../../secrets/augustus/kanidm.yaml`.
- **The lifeline class is permanent**: cicero/aedilis/step-jwk files never move
  to 1Password — for them module-local _is_ the end state.
- `nix-config/secrets/` disappears entirely; inventory moves to the
  `secretspec.toml` declarations (names + descriptions + scopes), which is
  better inventory than `ls`-ing encrypted blobs.

The move is cheaper than it looks: **no re-encryption is required**. Sops
recipients are embedded in each file's metadata — decryption is
path-independent. Relocating = `git mv` + update the `sopsFile` paths in the
declaring modules + widen the `.sops.yaml` `path_regex` so future sops edits
match the new locations. The regex can match old and new layouts
simultaneously (`(^|/)secrets/[^/]+\.yaml$`), so the relocation is
**incremental — one service per commit** — not a big bang.

Tradeoff accepted: a central `secrets/` tree made "all encrypted material in
git" auditable at a glance; scattered files shift that job to the declaration
layer. Secret scanners match `ENC[` content markers, not paths, so tooling is
unaffected.

### 4.3 Delivery: exec wrappers (no renderer, no reconciliation unit)

**Superseded design:** the earlier plan had a self-built
`system-secretspec.nix` bridge — oneshot units running `secretspec export`
into a renderer that rewrote the same `/run/secrets/<name>` paths sops-nix
uses. Dropped by decision: `secretspec run` + `as_path` already deliver
secrets at service start, so host delivery is a **lightweight exec wrapper
around each service's binary** — no daemon, no generation dirs, no path
compatibility layer:

```
systemd unit (or launchd agent / HM package override):
  ExecStart = <wrapper>            # in the Nix store: NAMES only, never values
  wrapper   = exec secretspec run --profile <host> --scope <svc> \
              -f ${self}/nix-config/secretspec.toml \
              -- <glue: sh -c '…env renames…; exec real-bin "$@"'>
```

Mechanics (verified against the vendored 0.21.1 source):

- **`as_path = true` secrets** → `run` writes the value to a temp file
  (mode 0400, owner = service user) and injects the env var as its absolute
  path; the file lives exactly as long as the wrapped child (`run` holds the
  temp files until the child exits, then deletes them). For daemons that
  read secrets from files — our own failure-notifs (`PUSHOVER_*_FILE`) and
  homelab-api (`TOKEN_ISSUER_PRIVATE_KEY_SECRET_PATH`,
  `OPENROUTER_API_KEY_FILE`) already speak exactly this dialect, as the e2e
  pipeline proved — this is a native fit.
- **Raw-value secrets** → plain env injection for env-native daemons
  (containers via `--env NAME` pass-through, grafana `GF_*`, restic
  `RESTIC_PASSWORD_FILE`). `/proc/<pid>/environ` is same-uid+root readable —
  comparable to the 0400 files sops-nix writes today; values never touch the
  Nix store (wrappers carry names only), argv (`--env NAME`, never
  `NAME=value`), or the journal.
- **Glue scripts** bridge name mismatches: fleet manifest names are lowercase
  (sops yaml keys, Phase 1), daemons expect their own env names —
  `sh -c 'export PUSHOVER_USER_KEY_FILE="$pushover_user_key"; exec "$@"' _`
  keeps the manifest untouched. Note `run --scope` actively SCRUBS
  out-of-scope secret names from the child env — wrappers must not rely on
  ambient secret env (feature, not bug).
- **Storage access (sops interim):** the unit exports `SOPS_AGE_KEY_FILE`
  pointing at the same host key file sops-nix uses; the sops provider reads
  the module-local encrypted yamls through the store copy of the repo
  (relative alias paths rebase against the `-f` manifest's dir — the store
  copy is self-contained; ciphertext in the store is fine, values are not).
  **1Password end-state:** a per-service SA token via `LoadCredential=` or a
  0400 root-provisioned `EnvironmentFile=` — the vault/SA granularity this
  forces is §9 Q1.
- **Restart semantics improve:** every `systemctl restart` re-resolves values
  (rotation = restart; no activation dependency); `After=network-online.target`
  only for units whose chain includes 1Password.
- **Units use `run`, never `export`:** `export` persists its as_path temp
  files (no child-lifetime cleanup); `run` deletes them on child exit. The
  openclaw-style `eval $(secretspec export --format shell)` pattern stays
  acceptable only where the scope contains no as_path secrets.
- Nix plumbing = one lib helper (`mkSecretspecWrapper { profile, scope,
  target, glue? }`) + per-service module edits; no new state, no /etc files,
  nothing to reconcile.

**Hard scope boundaries — what wrappers do NOT cover** (stays sops-nix;
renderer-shaped problems we deliberately do not solve):

1. **Activation-time consumers**: `services.kanidm.provision.*`
   (adminPasswordFile, every catalog `basicSecretFile`), peesequel postgres
   passwords — consumed by generated activation/oneshot scripts during
   `nixos-rebuild`. Secrets ALSO consumed by an app at runtime (OIDC client
   secrets, db passwords) get a dual-mechanism interim: wrapper for the app
   side, sops-nix for the provisioner — same storage file, two READERS, no
   conflict (exactly one writer is preserved: sops-nix keeps writing its
   /run/secrets path until Phase 4 deletes the declaration).
2. **Config-file templates with no env alternative**: radius.toml
   (kanidm-radius), smb credentials (kernel `mount.cifs` needs a stable real
   file), the serial-numbers JSON (composed), step-ca's yk-pin.txt (static
   `pin-source=` path inside the KMS URI).
3. **Lifeline class (§6)**: cicero step-ca, all four ssh-cert-renewers,
   aedilis technitium, praeconinus homelab-api — untouched until Phase 5; no
   delivery experiments on CA/DNS/SSH/public-VPS paths.
4. **Non-root service users during the sops interim**: a wrapper running as
   the service user needs the host age key → that user could decrypt EVERY
   sops file the key recipients cover (blast-radius growth vs sops-nix's
   root-decrypts-once model). Policy: waves are gated — root-run and
   user-level (jacob-owned: workstation HM, mini) deliveries first; non-root
   daemons wait for per-service credentials (§9 Q1) or per-module age keys.

### 4.4 1Password operations

- **Service accounts are created manually** (1Password web UI or
  `op service-account create`). SecretSpec cannot create them; a 1Password
  Terraform provider exists if we later want automation. One-time cost:
  ~6 SAs (per-host) or ~20 (per-service — §9 Q1).
- Vault layout — **reopened as §9 Q1 by the wrapper model (§4.3)**: the
  original recommendation was one vault per host (`homelab-augustus`,
  `homelab-nixos`, `homelab-mini`, … — plus `homelab-dev` for human/dev use),
  each host SA read/write on **its** vault only (a compromised host cannot
  drain the fleet). But a per-host SA token must be readable by every wrapped
  service user on that host — re-exposing host-wide scope; per-service
  vaults+SAs restore least privilege at the cost of ~14 extra vaults/SAs on
  augustus alone. Secrets land as Secure Notes
  `secretspec/homelab/<host>/<key>` (convention) — browseable and rotatable
  in the 1Password UI.
- **Token bootstrap (chicken-and-egg)**: the SA token itself must reach the host
  through a channel that doesn't need 1Password.
  - Interim: sops-nix — one new secret `secretspec_sa_token` per host (or per
    service — §9 Q1) in a tiny `secrets/<host>/secretspec.yaml`; the wrapped
    service's unit gets it via `LoadCredential=` or a root-provisioned 0400
    `EnvironmentFile=` (never `Environment=` inline).
  - End state: `systemd-creds encrypt --name=secretspec-sa-token` (host-bound,
    TPM2 where available) + `LoadCredentialEncrypted=`; the wrapper reads it
    through SecretSpec's read-only `systemd-credential://` provider — exactly
    the upstream design. This removes the last sops-nix dependency.
- SA token rotation: 1Password SAs support expiry/rotation; rotating = issue
  new token, update the bootstrap, restart the wrapped services. Document in
  the runbook.

## 5. `as_path` vs env vs files — the delivery decision (REVISED)

The original recommendation (host files under `/run` via a self-built
renderer) is **superseded** by decision + Phase 2 experience:

- **Host services: exec wrapper (`secretspec run`) around the daemon** —
  `as_path` (0400 temp file, env = path, lifetime = child process) wherever
  the daemon reads secrets from files via `*_FILE`/`*_PATH`-style env;
  raw env injection for env-native daemons. Values never in the Nix store
  (wrappers carry names only), never in argv/journal; env is same-uid+root
  readable via `/proc` — comparable to today's 0400 `/run/secrets` files.
- The renderer/reconcile module is dropped: it duplicated what `run` +
  `as_path` provide, and its path-compatibility trick only matters for
  consumers that genuinely need stable real files (kernel smb credentials,
  config-file templates) — those stay sops-nix instead (§4.3 boundaries).
  The upstream `nixos.md` warning ("don't reuse as_path as managed-file
  delivery") is respected in spirit: as_path files are per-process ephemera,
  not a managed /run tree.
- **Dev workflows: raw env, generated per run** — validated in Phase 2
  (single generation event shared by all children of one `run`; the staging
  script's file assembly keeps the server's path-based contract; fallback
  self-generation keeps CI independent of secretspec).
- systemd-creds (`LoadCredentialEncrypted=`) remains a future hardening
  option — most relevant for the SA-token bootstrap (Phase 5) — not a
  delivery mechanism for this migration.

## 6. Migration classification policy

Not everything should move to 1Password:

| Class          | Hosts/services                                                                                                                                                                                    | End-state provider                                                                           | Rationale                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Cloud-ok       | augustus apps (kanidm, planka, openwebui, hass, grafana, habitsync, radius, unpoller, minecraft, homelab-api extras, failure-notifs, technitium-metrics), nixos smb, mini openclaw, opencode keys | 1Password SA                                                                                 | augustus already depends on the internet (ACME, tailscale, images); boot-time resolve is acceptable |
| Lifeline-local | cicero step-ca (all), aedilis technitium + step-ca, all hosts' `step_jwk_provisioner_password`, praeconinus homelab-api                                                                           | **stay on local encrypted files** (sops provider via SecretSpec, or plain `age` files later) | CA, public DNS, SSH cert renewal and the public VPS must boot/work during a 1Password outage        |
| Dev/ephemeral  | e2e fixtures, local dev                                                                                                                                                                           | `null`/`dotenv` + `generate`                                                                 | no durable storage needed                                                                           |

The declaration layer (secretspec.toml) applies to **all** classes uniformly —
only the provider chain differs. That's the whole point: "migrate to
SecretSpec" ≠ "migrate everything to 1Password".

## 7. Phases

Each phase ends with: `nix eval` all 10 configs + snapshot diff,
`secretspec check --profile <host> --scope <svc>` on affected hosts, gates
(nixfmt/formatting/shellcheck), one commit. Rollback = revert commit (sops yamls
stay in git history; nothing is deleted until its replacement is verified).

### Phase 0 — Vendor + tooling (done except commit hygiene)

- `repos/secretspec` submodule @ v0.21.1 (flake.lock-parity not applicable;
  tag = nixpkgs-unstable pin).
- Add `pkgs-unstable.secretspec` to the devshell; record version assertion in
  the wrapper helper (`package` option + min-version check).

### Phase 1 — Declaration layer + module-local relocation ✅ DONE

Outcome (commits `78ff646849` Phase 1a, `ca9770616e` Phase 1b, Phase 1c =
this change):

- `.sops.yaml` regex: **no change needed** — the existing
  `secrets/([^/]+/)?[^/]+\.yaml$` substring-matches module-local
  `…/<module>/secrets/<host>.yaml` paths.
- Relocation: 16 single-consumer files moved as pure `git mv` (1a); the 7
  multi-consumer files split into 11 module-local files via a user-run sops
  script (1b); four file-shaped modules promoted to directories
  (apps-minecraft, networking-unpoller, identity-step-ca,
  homelab-ssh-cert-renewer); `nix-config/secrets/` retired entirely.
  ssh-cert-renewer chose dir promotion (over shared-secrets).
- Specs (three layers, §4.1): 16 module parents + 3 host parents
  (`system-configs/{augustus,nixos,aedilis}/secretspec.toml` for the
  host-specific secrets) + ONE pure-composition root manifest
  `nix-config/secretspec.toml` (extends + `host_op_*` placeholders only).
  Per-host _child_ specs and root-held declarations were both dropped after
  empirical testing (multi-level relative sops:// URIs break; every document
  needs ≥1 profile — an empty `[profiles]` table satisfies the root).
  `shared-secrets/` deferred (empty anchor parents fail validation).
- Key-name behavior: **verified** — sops lookup is case-sensitive
  (`[project,profile,key] → [profile,key] → [key]`); lowercase logical names
  matching yaml keys resolve with no `ref` mapping.
- Devshell helper: `secrets-check <host> [--scope <svc>]`.
- Verified: `secretspec check` green for all 6 profiles (augustus 39, nixos 5,
  cicero 3, aedilis 7, praeconinus 1, mini 5) and all 27 scopes, with
  `null://` placeholders standing in for the Phase-4 1Password aliases.
- **Deliverable value:** single machine-readable inventory of every secret
  (name, description, owner-service, scope) — previously spread across
  20 Nix files.

### Phase 2 — Dev/e2e secrets ✅ DONE

Outcome (this change): repo-root `secretspec.toml` (project `homelab-dev`;
manifest discovery walks up from CWD, so `nix-config/` still finds the fleet
manifest first) with `development` + `e2e` profiles — **pure ephemeral
generation**, no storage:

- `JWK_PASSPHRASE` (password 43, alphanumeric) and `HMAC_SECRET` (hex,
  `bytes = 32` → the same 64-hex-char shape the server contract expects),
  both `providers = ["ephemeral"]` (`null://`) + `generate`. Verified
  semantics: one generation event per materializing resolution — children of
  a single `secretspec run` share values, the next run gets fresh ones,
  nothing is written anywhere ("generated for this resolution without
  provider storage").
- The earlier dotenv-persistence sketch is DROPPED (decision: generate on the
  fly; no dev/e2e secret needs a stable identity beyond one run).
  `OPENROUTER_API_KEY`, the API-key contract and the serial numbers stay
  script constants — non-secret fixtures with fixed e2e-contract values;
  generating them would add nothing.
- Injection point = the staging script, not the server: `scripts/e2e.sh`
  runs `secretspec run --profile e2e -- node scripts/stage-e2e-secrets.mjs`
  when secretspec is on PATH (devshell), else bare `node` (CI deliberately
  has no Nix — the script's fallback path is the legacy behavior, unchanged).
  The script consumes the injected env and keeps the assembly it uniquely
  does (ES256 keygen + PBES2 JWE wrap via `jose`).
- Consistency rule: the JWK JWE is only decryptable with the matching
  passphrase, so in injected mode the derived fixtures (JWE, public JWK,
  passphrase file, hmac-secret) are ALWAYS regenerated from the same
  generation event — at the paths the effective `.env-serve-test` references
  (parsed from the file; hand-tuned setups may point
  `TOKEN_ISSUER_PRIVATE_KEY_SECRET_PATH` somewhere other than the stock
  `private/jwk-secret`, and regenerating a mismatched pair fails the server
  boot with JWEDecryptionFailed — learned empirically). Secret files are
  pinned 0600. Static contract files (api-keys.json, serial-numbers.json,
  openrouter dummy, .env-serve-test itself) keep never-overwrite semantics
  in BOTH modes, so hand-tuned dev setups survive.
- The server itself is NOT wrapped: its env contract is file paths
  (HOMELAB_SECRET_FILE, TOKEN_ISSUER_PRIVATE_KEY_SECRET_PATH, …) fed from
  `.env-serve-test` via dotenvx, and the unit-test layer hardcodes `private/`
  paths — the files must exist regardless, so `as_path` injection would be
  redundant here and would mask hand-tuned env files (process env beats
  dotenvx). `as_path` gets its prove-out in Phase 3 instead.
- `require_reason = false` in the dev manifest (throwaway values; keeps
  e2e.sh / seed-secrets / CI frictionless). The fleet manifest keeps
  `"agents"`.
- Devshell: new `seed-secrets` command = staging under the `development`
  profile; watch commands (`yarn workspace homelab-server dev`) then read the
  staged files as before.
- Verified: `secretspec check` green for both profiles + the `server` scope;
  `run` injects correctly-shaped values (lengths/patterns asserted, values
  never printed); staging smoke-tested in both modes; full e2e suite green
  via the devshell `e2e` command.

### Phase 3 — Exec-wrapper delivery (SCOPED; waves gated per §4.3)

Design = §4.3 (wrapper + as_path/env glue; NO renderer, NO /run/secrets
rewrite). Storage stays the sops yamls throughout — this phase changes
_delivery_ only. One service per commit; each ends with
`secrets-check <host> --scope <svc>` green + service health verified.

- **3a infra**: `mkSecretspecWrapper` lib helper (nix-config/lib/);
  secretspec package on augustus; `SOPS_AGE_KEY_FILE` wiring. No consumer
  changes. Smoke: wrapper resolves a null-provider test spec end-to-end on
  the host (no real secrets touched).
- **3b pilot — failure-notifs@augustus** (root-run, our script, 2 secrets):
  as_path + glue — the script's `PUSHOVER_USER_KEY_FILE`/`PUSHOVER_TOKEN_FILE`
  contract needs ZERO script changes; delete the two `sops.secrets.pushover_*`
  declarations (the yaml keeps the values — storage still sops until
  Phase 4). Soak: reboot augustus, fire a test notification, confirm no
  `/run/secrets/pushover_*` dependency remains.
- **3c root-run wave**: technitium-metrics-token oneshot (our inline script
  switches from baked `cat` paths to env — tiny rewrite); the six restic
  backup jobs (kanidm, planka, habitsync, openwebui, minecraft, postgres —
  `RESTIC_PASSWORD_FILE` via as_path; the wrapper point inside the restic
  module's generated script is TBD at implementation). Root-run → no
  credential blast-radius change.
- **3d rootful-container wave** (podman runs root-side): planka, habitsync,
  openwebui — replace environmentFiles/bind-mounted secret files with
  `secretspec run -- podman run --env NAME` pass-throughs (values never in
  argv). Their activation-side consumers (peesequel, kanidm provision) stay
  sops-nix — dual readers, same storage (§4.3 boundary 1).
- **3e user-level wave** (jacob-owned, no privilege issue): mini openclaw
  (swap the 5-file cat/wait-loop wrapper for one `secretspec run`); nixos HM
  opencode (wrap the opencode binary OR use the 1Password-desktop provider —
  §9 Q4).
- **3f gated wave — non-root daemons** (BLOCKED on the §9 Q1 credential
  decision): grafana (`GF_*` env + `$__env{}` provisioning refs), unpoller
  (env overrides — verify names first), home-assistant (`!env_var` YAML refs —
  verify support in our HA version), homelab-api + homelab-secret-provisioner
  (as_path fits env.ts natively; api-keys.json + serial-numbers stay rendered
  files).
- **Out of scope — stay sops-nix**: kanidm provision secrets, radius.toml,
  smb credentials, serial-numbers template, ALL lifeline services
  (cicero/aedilis/praeconinus + ssh-cert-renewer ×4), step-ca.

### Phase 4 — 1Password cutover, service by service

Prerequisite: §9 Q1 (vault/SA granularity) decided — the wrapper model leans
per-SERVICE vaults+SAs for least privilege (a per-host SA readable by any
wrapped service user re-creates the blast radius §4.3 boundary 4 avoids).

Per service, in Phase 3 wave order (3b → 3c → 3d → 3e → 3f):

1. Create the vault + SA (manual); bootstrap the token via sops-nix
   (`secrets/<host>/secretspec.yaml`, delivered 0400 to the service user).
2. On the host: `secretspec import onepassword --profile <host> --scope <svc>`
   (copies missing values; never overwrites).
3. Flip the service's chain to `["host_op_*"]` (drop the sops alias);
   redeploy; verify `check --scope` + service health.
4. `git rm` the service's sops yaml — its sops-nix declarations are already
   gone (Phase 3) or dual-reader leftovers removed here.
5. Rotate anything sensitive that lived in git history as a follow-up task
   (the yamls were encrypted, so this is optional hygiene, not incident
   response).

Services deferred by §4.3 boundaries (kanidm provision, radius, smb, serial
numbers) and the lifeline class skip this phase — their endgame is Phase 5.

### Phase 5 — Retire sops-nix

- Remaining sops-nix usage after Phases 3–4 = lifeline secrets, the
  activation-time consumers (kanidm provision, peesequel), the
  template-bound configs (radius.toml, smb creds, serial numbers, yk-pin),
  and the SA-token bootstrap.
- Move SA-token bootstrap to `systemd-creds` encrypted credentials (§4.4);
  wrappers read via SecretSpec's `systemd-credential://` provider.
- Lifeline secrets: either (a) keep sops-nix for just those files, or
  (b) point the same wrappers' chains at SecretSpec `age`/`sops` providers
  and let sops-nix the _NixOS module_ die entirely; `sops`/`age` remain as
  encryption tools. The activation-time + template consumers decide whether
  (b) is complete or a residual sops-nix stays for them.
- Deferred services (radius, kanidm provision, smb) get an explicit decision
  here: stay sops-nix permanently, or revisit when upstream ships reconcile.

### Phase 6 — Future (upstream convergence)

- When SecretSpec ships the reconcile/NixOS module (§2 gap), re-evaluate the
  renderer-shaped leftovers (templates, activation-time consumers) —
  wrappers stay for everything else; persistent systemd-encrypted
  credentials then also solve offline boot for 1Password-backed secrets.
- Watch: dynamic secrets/leases (`dynamic-secrets.md` draft) — could replace
  the technitium metrics-token TOTP dance with short-lived leases; docker/git
  credential helpers (0.20+) for dev ergonomics.

## 8. Risks & mitigations

| Risk                                                                                              | Mitigation                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boot-time dependency on 1Password (cloud outage → secrets unresolvable)                           | Lifeline classification (§6); sops fallback stays in chains until a service proves stable on 1Password; `After=network-online.target` only where the chain needs it; upstream persistent-credential destination later |
| Service-user reads storage credentials (age key / SA token) → blast radius beyond its own secrets | Wave gating (§4.3 boundary 4): root-run + user-level deliveries first; non-root daemons only after per-service vaults/SAs (§9 Q1) or per-module age keys                                                              |
| Wrapper glue scripts: env names drift from manifest names                                         | Glue lives in the service's own module beside its declarations; `secrets-check <host> --scope <svc>` + service health gate every cutover commit                                                                       |
| `export`-based flows persist as_path temp files (no child-lifetime cleanup)                       | Units use `run` exclusively; `export` only for dev/e2e and eval-style wrappers whose scope has no as_path secrets                                                                                                     |
| Restart-time resolution latency + secretspec version churn on hosts                               | Pin secretspec (pkgs-unstable, like other tools); re-vendor submodule on bumps; wrapper smoke test in 3a; sops-provider resolution is local (ms) until Phase 4                                                        |
| Value model = UTF-8 strings                                                                       | All current secrets are text (verified inventory); binary future needs → `encoding = "base64"`                                                                                                                        |
| Key-name case mismatch sops-yaml↔spec                                                             | Resolved in Phase 1: lowercase names, case-sensitive flat lookup, no refs needed                                                                                                                                      |
| Dual readers during transition (wrapper + sops-nix activation on one secret)                      | Same storage file, read-only on both sides; per-service atomic cutover of the runtime side; exactly one WRITER preserved; snapshot diff enforces                                                                      |
| SA token sprawl/leak                                                                              | Least-privilege vault scoping (§9 Q1), expiry + rotation runbook, token via LoadCredential/0400 EnvironmentFile — never inline `Environment=`, never in the store                                                     |
| Agent (opencode) secret access                                                                    | `require_reason = "agents"` on the fleet manifest + local audit log; keep `sops`/`op` shell deny rules; the dev manifest is `false` (throwaway generated values only)                                                 |

## 9. Open questions

1. **Vault/SA granularity (gates Phases 3f + 4):** per-host vault+SA
   (simple, ~6 SAs, but any wrapped service user on the host can read every
   host secret — blast radius) vs per-service vaults+SAs (~14 on augustus;
   true least privilege; more manual creation + token bootstrap files).
   Recommendation: per-service for non-root host daemons; per-host
   acceptable for user-level (nixos/mini) where the user already owns the
   storage credentials. DECIDE before 3f.
2. Lifeline classification (§6) — cicero/aedilis/step-jwk/praeconinus stay
   on local encrypted files permanently. ✅ agreed ("sops files are fine").
3. Pilot failure-notifs@augustus — still the right pilot under the wrapper
   model (root-run, our script, as_path needs zero script changes). ✅
4. HM opencode keys: wrapper-injected env/as_path (headless-safe) vs the
   1Password-desktop provider on the workstation (simpler, needs the app
   running)? Probably wrapper for parity, desktop for interactive dev.
5. Dual-mechanism interim acceptable for OIDC client secrets + db passwords
   (app side wrapped while kanidm-provision/peesequel stay sops-nix)?
6. Deferred-services endgame (radius.toml, smb creds, kanidm provision,
   serial numbers): stay sops-nix permanently vs revisit at upstream
   reconcile (Phase 6)?
7. Do we want `secretspec`-based docker/git credential helpers in the
   devshell (0.20+)?
