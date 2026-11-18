# SecretSpec Migration Plan

> Status: **Phase 1 COMPLETE** — declaration layer live; all sops files are
> module-local; `secretspec check` resolves 60/60 secrets across the 6 host
> profiles. Phases 2–6 pending. Vendor research against `repos/secretspec`
> @ v0.21.1 (= nixpkgs-unstable pin; nixpkgs-26.05 carries a stale 0.10.1).
> Predecessor work: per-service sops split (commit `24d6d41179`).

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
| `export --format json --scope S`                   | ✓                 | The bridge primitive: one JSON object of name→value                                                                                                                                                                                                                                             |
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
pairs SecretSpec (declaration + resolution) with a **thin self-built NixOS
bridge** for delivery, designed to be retired when upstream reconcile ships.

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
  affects composed references, which the bridge renderer replaces anyway.)
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

### 4.3 Delivery bridge (the self-built part)

New module `modules/system/system-secretspec.nix` (+ HM and darwin variants):

```nix
services.secretspec = {
  enable = true;
  profile = "augustus";                    # = host name
  specFile = ./secretspec.toml;            # value-free → safe in the Nix store
  sets = {
    failure-notifs = {                      # one reconciliation "set" per service
      scope = "failure-notifs-augustus";
      files = {                             # → /run/secrets/<name> (SAME paths sops-nix uses)
        pushover_user_key = { owner = "root"; mode = "0400"; };
        pushover_token    = { owner = "root"; mode = "0400"; };
      };
    };
    kanidm = {
      scope = "kanidm";
      files = { kanidm_admin_passphrase = { owner = "kanidm"; group = "kanidm"; }; /* … */ };
      rendered = {                          # successor of sops.templates
        "kanidm-backup-passphrase" = {
          owner = "restic";
          content = "${KANIDM_RESTIC_BACKUP_PASSPHRASE}";   # ${NAME} refs resolved at runtime
        };
      };
    };
  };
};
```

Implementation notes:

- A oneshot systemd unit per set (or one unit iterating sets), ordered
  `After=network-online.target` only when a remote provider is in the chain.
  ExecStart runs `secretspec export --profile <host> --scope <set> --format json`
  piped into a small renderer (jq/awk or a tiny static helper) that:
  1. writes a fresh generation dir under `/run/secretspec/gen-<N>/`,
  2. materializes each declared file (owner/group/mode via install/chmod),
  3. renders `rendered` templates by `${NAME}` substitution **in memory** from
     the JSON (content strings come from Nix, so constants/ports stay
     single-sourced in `constants.nix` — unlike static `composed` TOML),
  4. atomically swaps symlinks `/run/secrets/<name>` (or a per-set dir) into place.
- **Path compatibility is the migration trick:** the bridge writes the _same_
  `/run/secrets/<name>` and `/run/secrets/rendered/<name>` paths sops-nix uses.
  A service cutover = remove its `sops.secrets.*` declarations, add its
  `services.secretspec.sets.<svc>` binding — consumer modules (`passwordFile =
  config.sops.secrets.X.path` → `… = "/run/secrets/X"` or a shared option) are
  the only diff, and can even be kept identical via a `config.secretspec.paths.X`
  helper. Exactly one writer per secret at any time.
- Restart coordination: v1 = none beyond boot/activation ordering (document
  manual `systemctl restart` after rotations); v2 = renderer compares old/new
  values in memory and sets a marker that triggers `restartUnits` like sops-nix.
- Security rules inherited from `nixos.md` (non-negotiable): no values in Nix
  eval/store/argv/journal; plaintext only in memory and tmpfs; the spec file in
  the store carries names only; audit log stays on the host.
- HM variant: `home.activation` (or a user systemd unit) resolving
  `--scope opencode` into `~/.config/secretspec/files/` (0600); opencode
  provider `{file:…}` references repoint there. Dev machines can instead use
  the keyring/1Password-desktop provider interactively.
- darwin variant (mini): the openclaw gateway wrapper already `cat`s secret
  files into env vars before exec — swap the `cat`s for a single
  `eval $(secretspec export --scope openclaw --format shell)` (wrapper runs as
  jacob; desktop-app or SA provider). No system-level bridge needed on mini.

### 4.4 1Password operations

- **Service accounts are created manually** (1Password web UI or
  `op service-account create`). SecretSpec cannot create them; a 1Password
  Terraform provider exists if we later want automation. One-time cost: ~6 SAs.
- Vault layout (recommended): one vault per host — `homelab-augustus`,
  `homelab-nixos`, `homelab-mini`, … — plus `homelab-dev` for human/dev use.
  Each host SA gets read/write on **its** vault only (least privilege; a
  compromised host cannot drain the fleet). Secrets land as Secure Notes
  `secretspec/homelab/<host>/<KEY>` (convention) — browseable and rotatable in
  the 1Password UI.
- **Token bootstrap (chicken-and-egg)**: the SA token itself must reach the host
  through a channel that doesn't need 1Password.
  - Interim: sops-nix — one new secret `secretspec_sa_token` per host in a
    tiny `secrets/<host>/secretspec.yaml`; the bridge unit gets it via
    `EnvironmentFile=`/`LoadCredential=` (never `Environment=` inline).
  - End state: `systemd-creds encrypt --name=secretspec-sa-token` (host-bound,
    TPM2 where available) + `LoadCredentialEncrypted=`; the bridge reads it
    through SecretSpec's read-only `systemd-credential://` provider — exactly
    the upstream design. This removes the last sops-nix dependency.
- SA token rotation: 1Password SAs support expiry/rotation; rotating = issue
  new token, update the bootstrap, restart the bridge units. Document in the
  runbook.

## 5. `as_path` vs env vs files — the delivery decision

Judgment call requested; recommendation:

- **Host services: files under `/run` (tmpfs) with unix owner/mode — not env,
  not `as_path`.** Nearly every consumer takes a `*File` option (kanidm
  provision, step-ca, restic `passwordFile`, caddy `basicSecretFile`, …); env
  vars leak to every child process and are world-readable via
  `/proc/<pid>/environ` for same-uid processes; a 0400 owner-only tmpfs file is
  the tighter boundary and matches today's semantics exactly (zero consumer
  churn). Upstream `nixos.md` itself says `as_path` must **not** be reused as
  the managed-file implementation — it's a process/SDK transform with temp-dir
  paths and no owner/group control.
- **Dev workflows: env is right** — `secretspec run -- <cmd>` for short-lived
  shells/processes; `as_path = true` only where a tool insists on a file path
  (e.g. `GOOGLE_APPLICATION_CREDENTIALS`, generated SSH keys for a one-off cmd).
- So the user's instinct ("keep them in the environment, avoid secrets on
  disk") holds for _dev_, with the nuance that on hosts the tmpfs-file model is
  both the status quo and the more secure option; `/run` _is_ "not on disk".

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
  the bridge module (`package` option + min-version check).

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

### Phase 3 — Bridge module + pilot (augustus/failure-notifs)

- Build `system-secretspec.nix` (§4.3) + renderer; unit-tested against a
  `null`-provider spec in a VM-less check first (renderer is pure: JSON in,
  files out).
- Pilot = failure-notifs (2 root-owned secrets, no template, low blast
  radius): declare `services.secretspec.sets.failure-notifs`, delete the two
  `sops.secrets.pushover_*` declarations, keep values in the sops yaml
  (provider chain still `sops_pushover` until Phase 4).
- Soak: reboot augustus, verify `/run/secrets/pushover_*` identical
  (perms/owner/content hash), failure-notifs still fires test notification.
- Then roll the bridge out to remaining augustus services one commit each
  (still sops-backed — this phase changes _delivery_, not _storage_).

### Phase 4 — 1Password cutover, service by service

Per service (start with the pilot):

1. Create vault `homelab-augustus` + SA (manual, once per host); bootstrap the
   token via sops-nix (`secrets/<host>/secretspec.yaml`).
2. On the host: `secretspec import onepassword --profile augustus --scope <svc>`
   (copies missing values into 1Password; never overwrites).
3. Flip the service's chain to `["host_op"]` (drop the sops alias); redeploy;
   verify `check --scope` + service health.
4. `git rm` the service's sops yaml; delete its sops-nix declarations (already
   gone in Phase 3) — done.
5. Rotate anything sensitive that lived in git history as a follow-up task
   (the yamls were encrypted, so this is optional hygiene, not incident
   response).

Order: failure-notifs → unpoller → minecraft → grafana → technitium(aug) →
habitsync → planka → openwebui → home-assistant → radius → kanidm →
homelab-api(aug) → smb(nixos) → openclaw(mini) → opencode(nixos HM).
Lifeline-class services skip this phase entirely.

### Phase 5 — Retire sops-nix

- Remaining sops-nix usage = lifeline secrets + SA-token bootstrap.
- Move SA-token bootstrap to `systemd-creds` encrypted credentials (§4.4);
  bridge reads via `systemd-credential://` provider.
- Lifeline secrets: either (a) keep sops-nix for just those files, or
  (b) convert them to SecretSpec `age`/`sops` provider files resolved by the
  same bridge — then sops-nix the _NixOS module_ is fully gone; `sops`/`age`
  remain only as encryption tools.
- mini (darwin) + HM configs cut over via their variants (§4.3).

### Phase 6 — Future (upstream convergence)

- When SecretSpec ships the reconcile/NixOS module (§2 gap), replace the
  bridge set-by-set; persistent systemd-encrypted credentials then also solve
  offline boot for 1Password-backed secrets.
- Watch: dynamic secrets/leases (`dynamic-secrets.md` draft) — could replace
  the technitium metrics-token TOTP dance with short-lived leases; docker/git
  credential helpers (0.20+) for dev ergonomics.

## 8. Risks & mitigations

| Risk                                                                    | Mitigation                                                                                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Boot-time dependency on 1Password (cloud outage → secrets unresolvable) | Lifeline classification (§6); sops fallback stays in chains until a service proves stable on 1Password; upstream persistent-credential destination later     |
| Self-built bridge = maintenance surface; upstream reconcile may differ  | Keep bridge thin (export+render+chmod, no daemon); path-compatible outputs make a later swap mechanical                                                      |
| SecretSpec project is young (0.x); CLI churn                            | Pin via pkgs-unstable like other tools; re-vendor submodule on bumps; conformance suite in-repo for the renderer                                             |
| Value model = UTF-8 strings                                             | All current secrets are text (verified inventory); binary future needs → `encoding = "base64"`                                                               |
| Key-name case mismatch sops-yaml↔spec                                   | Phase 1 explicitly verifies and records the answer before any cutover                                                                                        |
| Two writers of `/run/secrets/<name>` during transition                  | Per-service atomic cutover: a secret is declared in sops-nix OR bound in the bridge, never both; snapshot diff enforces                                      |
| SA token sprawl/leak                                                    | One SA per host, vault-scoped ACLs, expiry + rotation runbook, token never in env-inline/store                                                               |
| Agent (opencode) secret access                                          | `require_reason = "agents"` default + local audit log; keep `sops`/`op` shell deny rules, add `secretspec` get/export to the deny-or-ask list in permissions |

## 9. Open questions (for review before Phase 1)

1. Vault layout: per-host vaults (recommended) vs one `homelab` vault with
   profile-namespaced items?
2. Agree with the lifeline classification (cicero/aedilis/step-jwk/praeconinus
   stay on local encrypted files forever-ish)?
3. Pilot choice failure-notifs@augustus OK?
4. HM opencode keys: bridge-rendered user files (works headless) vs 1Password
   desktop provider on the workstation (simpler, needs app running)? Probably
   the former for parity, desktop for interactive dev.
5. Do we want `secretspec`-based docker/git credential helpers in the devshell
   (0.20+) as a Phase 2 extra?
