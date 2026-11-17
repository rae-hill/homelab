# SecretSpec Migration Plan

> Status: PLAN — not yet implemented. Vendor research done against
> `repos/secretspec` @ v0.21.1 (= nixpkgs-unstable pin; nixpkgs-26.05 carries a
> stale 0.10.1). Successor to the per-service sops split (commit `24d6d41179`).

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

### 4.1 Declaration layout

```
nix-config/
├── shared-secrets/
│   └── secretspec.toml            # cross-cutting parent: ssh-cert-renewer, etc.
├── modules/<category>/<module>/
│   └── secretspec.toml            # PARENT spec per service module:
│                                  #   declarations, descriptions, generate types,
│                                  #   interim sops alias, per-service scope
└── system-configs/<host>/
    └── secretspec.toml            # CHILD spec: extends the module specs of the
                                   #   services this host runs; binds host aliases
```

- Module spec example (`modules/identity/identity-kanidm/secretspec.toml`):

  ```toml
  [project]
  name = "kanidm"
  revision = "1.0"

  [providers]
  sops_kanidm = "sops://kanidm-secrets.yaml" # interim; see §4.2 for file location

  [profiles.default]
  KANIDM_ADMIN_PASSPHRASE = { description = "kanidm admin passphrase", providers = ["host_op", "sops_kanidm"] }
  KANIDM_IDM_ADMIN_PASSPHRASE = { description = "kanidm idm admin passphrase", providers = ["host_op", "sops_kanidm"] }
  KANIDM_RESTIC_BACKUP_PASSPHRASE = { description = "restic repo passphrase", providers = ["host_op", "sops_kanidm"] }

  [scopes.kanidm]
  secrets = [
    "KANIDM_ADMIN_PASSPHRASE",
    "KANIDM_IDM_ADMIN_PASSPHRASE",
    "KANIDM_RESTIC_BACKUP_PASSPHRASE",
  ]
  ```

- Host child spec example (`system-configs/augustus/secretspec.toml`):

  ```toml
  [project]
  name = "homelab" # one storage namespace; profile separates hosts
  revision = "1.0"
  extends = [
    "../../shared-secrets",
    "../../modules/identity/identity-kanidm",
    "../../modules/ai/ai-openwebui",
    # … exactly the services augustus runs (mirrors default.nix module list)
  ]

  [providers]
  host_op = "onepassword+token://homelab-augustus" # SA token via bootstrap (§4.4)

  [profiles.augustus.defaults]
  providers = ["host_op"]
  ```

- `host_op` is referenced by module specs but **bound by each host child** —
  verified-safe because `[providers]` merges across `extends` with the child
  winning. During the SOPS interim, module specs list `["host_op", "sops_<svc>"]`
  so resolution falls back to the yaml until values are imported (§7 Phase 4).
- Profile = host name. Secret storage address becomes
  `secretspec/homelab/<host>/<KEY>` — one convention everywhere.
- Multi-host modules (homelab-api, ssh-cert-renewer): declarations live in the
  module/shared parent once; host children may add profile-scoped provider
  overrides where interim sops files differ per host.
- Naming: keys are the existing secret names uppercased (SOPS yaml keys are
  lowercase; the `sops` provider maps by convention — verify exact key lookup
  (case sensitivity) in Phase 1 and record the answer here. If the sops provider
  is case-sensitive against yaml keys, keep yaml key names as the `ref.item`
  or rename yaml keys to uppercase during the move.)

### 4.2 Where the interim SOPS yamls live

Two options were considered:

- **(A) Keep them at `secrets/<host>/<service>.yaml`** (recommended). The
  module spec's sops alias points at them relatively
  (`sops://../../../secrets/augustus/kanidm.yaml`). sops-nix keeps reading the
  exact same files — zero file moves, zero re-encryption, and the file simply
  gets deleted when the service cuts over to 1Password. The yaml never moves
  next to the module because it dies there anyway.
- (B) Relocate yamls next to modules (`modules/identity/identity-kanidm/kanidm-secrets.yaml`).
  Prettier end-state picture, but requires re-encryption (`.sops.yaml` regex +
  recipients), touching every `sopsFile` again, for files that are transient.
  Only worth it for services that will _stay_ on sops long-term (the lifeline
  hosts — and those could move to plain `age` files later instead).

Decision: **A**, revisited only if upstream sops-provider ergonomics improve.

### 4.3 Delivery bridge (the self-built part)

New module `modules/system/system-secretspec.nix` (+ HM and darwin variants):

```nix
services.secretspec = {
  enable = true;
  profile = "augustus";                    # = host name
  specFile = ./secretspec.toml;            # value-free → safe in the Nix store
  sets = {
    failure-notifs = {                      # one reconciliation "set" per service
      scope = "failure-notifs";
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

### Phase 1 — Declaration layer (no runtime change)

- Write `shared-secrets/secretspec.toml` + one module `secretspec.toml` per
  service (§4.1), sops aliases pointing at the existing
  `secrets/<host>/<service>.yaml` files (option A), scopes per service, host
  child specs extending exactly their enabled modules.
- Verify key-name/case behavior of the sops provider against our lowercase
  yaml keys; document the finding; adjust spec keys or yaml keys accordingly.
- Add `secretspec check` per host profile to the validation routine (devshell
  helper `secrets-check <host>`); wire into the docs/skills.
- **Deliverable value:** single machine-readable inventory of every secret
  (name, description, owner-service, scope) — today that knowledge is spread
  across 20 Nix files.

### Phase 2 — Dev/e2e secrets

- Root (or `packages/homelab-server/`) `secretspec.toml` with profiles:
  - `development`: keyring/1Password-desktop provider for human tooling.
  - `e2e`: `dotenv://.secretspec-e2e.env` (gitignored) + `generate = true`
    types — first run mints and stores, later runs reuse (preserves the
    current never-overwrite behavior):
    `HMAC_SECRET` (hex 32), `JWK_PASSPHRASE` (password),
    `OPENROUTER_API_KEY` (default = dummy), serial numbers (hex), API keys
    (defaults = the fixed test contract values).
- Refactor `scripts/stage-e2e-secrets.mjs` to pull values via
  `secretspec export --profile e2e --format json` and keep only the fixture
  _assembly_ it uniquely does (JWK/JWE via `jose`, `api-keys.json` contract
  shape). SecretSpec can't produce JWE-wrapped JWKs — that logic stays.
- `require_reason` left at default (`"agents"`) → agent secret access is
  audit-logged with reasons.

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
