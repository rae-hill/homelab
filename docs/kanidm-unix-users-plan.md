# Kanidm Unix Users — Formal Implementation Plan

Formal plan for provisioning the `nixos` workstation's login user from Kanidm
(NSS + PAM) while preserving the existing step-ca SSH certificate flow, and
extending the same identity to the servers we deploy to via the SSH
certificate principal.

This plan supersedes the generic `docs/kanidm-nixos-users-preplan.md`. It is
written against **this repo's** module structure (flake-parts
`flake.modules.nixos.*`, `service-registry.nix` constants, `_private/<host>/`
host config) and against the **pinned nixpkgs (nixos-26.05)** vendored at
`repos/nixpkgs-26.05`, where several of the preplan's assumptions no longer
hold (see §0).

---

## 0. Corrections to the preplan (verified against pinned nixpkgs)

The preplan was written against generic/master nixpkgs. Three of its core
claims are **wrong for our pinned `nixos-26.05`** and change the plan
materially:

| Preplan claim                                                                 | Reality in `repos/nixpkgs-26.05`                                                                                                                                    | Consequence                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "The module wires **no** PAM rules — all PAM lines are yours (§4)."           | `security/pam.nix` auto-adds a `kanidm` rule (auth/account/session, `control = "sufficient"`, `ignore_unknown_user = true`) gated on `services.kanidm.unix.enable`. | **Skip the entire manual `security.pam.services.login.rules` block.** Enabling `unix` is sufficient for GDM login. Hand-writing the experimental `rules` API is an unnecessary lockout risk. |
| `pam_allowed_login_groups` lives at `unix.settings.pam_allowed_login_groups`. | Renamed to `unix.settings.kanidm.pam_allowed_login_groups` (there's an assertion enforcing this).                                                                   | Use the nested `kanidm.*` path.                                                                                                                                                              |
| POSIX attrs (`--gidnumber`, `--shell`) set declaratively.                     | `provision.persons`/`provision.groups` submodules have **no** posix/gidnumber/shell options, and `kanidm-provision` does not manage POSIX.                          | **POSIX enablement must be imperative** — a post-provision hook on augustus (see §3). This is the single biggest piece of net-new work.                                                      |

Confirmed unchanged / usable as-is:

- `services.kanidm.unix.enable` installs `kanidm-unixd` + tasks daemon and
  inserts `libnss_kanidm` into `nssDatabases`.
- `services.kanidm.unix.sshIntegration` wires the `AuthorizedKeysCommand`
  path (offline/static Kanidm SSH keys).
- step-ca's existing `OIDC` provisioner named `kanidm` already stamps the
  Kanidm username into the SSH cert principal (`defaultUserSSHCertDuration =
  "2h"`). **This is the working path we must not break.**

---

## 1. Goal & success criteria

**Context / motivation:** `jacob` is a deadname. The real driver for this work
is to move every system login onto the existing `rae` Kanidm identity and
**retire the `jacob` username entirely** — from the workstation greeter, from
`users.users`, from the home-manager profile key, and eventually from the
servers' local accounts and SSH principals. The `rae` person already exists in
Kanidm (`services/kanidm.nix` `provision.persons.rae`); it just needs POSIX
enablement and the client wiring.

**Primary goal:** log into the Kanidm account **`rae`** at the `nixos`
workstation GDM greeter, with the home config (home-manager) associated to
that identity.

**Hard constraint:** step-ca certificates must keep functioning exactly as
today — TLS issuance, SSH host-cert renewal (`ssh-cert-renewer`), and the
`step ssh proxycommand ... --provisioner kanidm` user-cert flow. (That flow
currently lives in the `jacob@nixos` home-manager profile and will move to a
`rae@nixos` profile — see §5.)

**Stretch goal:** the `rae` unix user + SSH certificate principal work when
connecting to servers we deploy to (augustus, cicero, praeconinus), so the
`rae` principal in the step-ca-issued cert maps to a resolvable unix identity
on the destination host — replacing the local `jacob` accounts there too.

Success criteria:

1. `getent passwd rae` on `nixos` resolves via Kanidm (NSS).
2. GDM login as `rae` succeeds (password factor).
3. `step ssh` user-cert login to augustus/cicero still works; `TrustedUserCAKeys`
   on the destination still validates the step-ca user CA.
4. `nix build .#nixosConfigurations.nixos.config.system.build.toplevel`
   evaluates; full validation (§7) passes.
5. No regression in step-ca TLS/SSH issuance.
6. End state: no `jacob` username remains on `nixos` (greeter, `users.users`,
   home dir, HM key). Servers follow in Phase 3.

### 1.1 No name collision — `rae` (Kanidm) alongside `jacob` (local)

The workstation **already** has a local `users.users.jacob` (uid 1000,
`_private/nixos/users.nix`) that owns `/home/jacob`, the sops age key
(`/home/jacob/.config/sops/age/keys.txt`), the ssh-agent socket
(`/run/user/1000/...`), and the `jacob@nixos` home-manager profile. The
preplan's "hard rule" is: **never declare a Kanidm-managed user in
`users.users`** — a name present in both `/etc/passwd` and Kanidm resolves to
the local entry (different uid), silently shadowing Kanidm.

Because the target Kanidm identity is **`rae`**, not `jacob`, **there is no
name collision** — which makes this migration cleaner than the generic
preplan assumed. We can stand up `rae` as a Kanidm-provided POSIX account on
`nixos` _alongside_ the untouched local `jacob`, prove it end-to-end (greeter,
step-ca, server SSH), migrate the per-user state (sops age key, ssh keys, HM
profile) from `/home/jacob` to the `rae` home, and only then remove local
`jacob`. No point in the migration requires a name that resolves two ways.

This replaces the earlier three-option dilemma. The sequence is:

- **Phase 1 — add `rae` as a Kanidm POSIX login on `nixos`** (NSS + PAM +
  `sshIntegration`), local `jacob` still present and functional. Prove
  greeter login as `rae`, confirm step-ca untouched.
- **Phase 2 — migrate state and retire local `jacob`** on `nixos`: move the
  sops age key + ssh keys into `rae`'s home, re-key the HM profile to
  `rae@nixos`, remove `users.users.jacob`.
- **Phase 3 — extend `rae` to servers** and retire the local `jacob`
  accounts there (augustus/cicero/praeconinus).

Keep local `jacob` as the recovery account only until Phase 2 completes on a
given host; never add `rae` to `users.users` (that re-introduces the shadowing
problem the preplan warns about).

> Note: this plan deliberately does **not** rename the Kanidm `rae` _person_
> or change the `jacob` Kanidm person's OIDC group memberships beyond what's
> needed. Retiring the `jacob` **Kanidm** person (distinct from the local unix
> `jacob`) is a separate cleanup tracked in §9.

---

## 2. Server side (augustus — Kanidm authority)

All Kanidm provisioning lives in `nix-config/modules/services/kanidm.nix`
(`flake.modules.nixos.kanidm`), which augustus imports. Work here is split
into _declarative_ (groups/persons/membership — supported) and _imperative_
(POSIX enablement — not supported declaratively).

### 2.1 Declarative: add unix login groups + membership

In `kanidm.nix` `provision.groups`, add:

```nix
"unix.workstations" = { };   # daily-use workstation login gate
"unix.sysadmins"    = { };   # maps to wheel on clients
```

Add the `rae` person to these groups in `provision.persons` (add
`"unix.workstations"` and `"unix.sysadmins"` to `rae`). These are plain Kanidm
groups — fully supported by the existing provisioning. Do **not** add the
`jacob` Kanidm person to the unix login groups; `jacob` is the identity we are
retiring.

### 2.2 Imperative: enable POSIX on groups + persons (net-new)

Because `kanidm-provision` cannot set POSIX attributes, add a **post-provision
oneshot** that runs after `kanidm.service` is up and idempotently POSIX-enables
the groups and persons. Model it on the existing `postStartScript` ordering
(it must run after the provisioning `postStart`).

New file: `nix-config/modules/features/kanidm-posix/service.nix`
(`flake.modules.nixos.kanidm-posix`), imported by augustus only. Sketch:

```nix
systemd.services.kanidm-posix-provision = {
  after = [ "kanidm.service" ];
  requires = [ "kanidm.service" ];
  wantedBy = [ "multi-user.target" ];
  serviceConfig.Type = "oneshot";
  # authenticate as idm_admin using the existing idmAdminPasswordFile,
  # then for each group: `kanidm group posix set <g> --gidnumber <N>`
  # for each person: `kanidm person posix set <u> --shell /run/current-system/sw/bin/zsh`
  # (gidnumber explicit, in the 65536-524287 band per preplan §1; document the
  #  allocation in service-registry.nix so it's a single source of truth)
  script = '' ... idempotent kanidm CLI calls ... '';
};
```

Design notes:

- **Explicit gidnumbers** (not dynamic) so uid/gid are stable and documented.
  Record the chosen numbers in `service-registry.nix` under a new
  `constants.unix` block (e.g. `workstationsGid`, `sysadminsGid`, per-user
  gidnumber). This keeps client `map_group` and server allocation consistent.
- Authenticate with `idm_admin` via the existing
  `config.sops.secrets.kanidm_idm_admin_passphrase` (already owned by
  `kanidm`). Use `kanidm login` into a transient `KANIDM_*` session dir inside
  the unit (never write tokens to the store).
- **Idempotent**: `posix set` is safe to re-run; the script must tolerate
  "already enabled".
- Shell path: use a stable path (`/run/current-system/sw/bin/zsh`) since zsh is
  already enabled system-wide.
- Register the unit for failure notifications:
  `services.failure-notifs.attachServices = [ "kanidm-posix-provision" ];`
  (add in `kanidm.nix` alongside the existing `kanidm` entry, since that list
  is augustus-scoped).

### 2.3 (Deferred) static SSH keys in Kanidm

Optional offline path: `kanidm person ssh-pubkey add <user> ...`. Not required
while step-ca is the primary SSH path. Add later if we want login when step-ca
is unreachable. Covered by client `sshIntegration` (§4).

---

## 3. Client — `nixos` workstation identity (NSS + PAM)

Add a reusable client module and wire it into the `nixos` host. **Do not**
hand-write PAM rules — `unix.enable` auto-wires them in our nixpkgs (§0).

New file: `nix-config/modules/features/kanidm-client/service.nix`
(`flake.modules.nixos.kanidm-client`):

```nix
flake.modules.nixos.kanidm-client = { config, lib, pkgs, ... }: {
  services.kanidm.package = pkgs.kanidmWithSecretProvisioning_1_11; # match server major
  services.kanidm.client.enable = true;
  services.kanidm.client.settings.uri = config.constants.idm.url;  # https://idm.plato-splunk.media

  services.kanidm.unix.enable = true;          # NSS + PAM (auto-wired) + unixd-tasks
  services.kanidm.unix.sshIntegration = true;  # AuthorizedKeysCommand (offline SSH keys)
  services.kanidm.unix.settings = {
    kanidm.pam_allowed_login_groups = [ "unix.workstations" ];
    # map Kanidm POSIX groups onto local system groups (Kanidm >= 1.4):
    kanidm.map_group = [
      { local = "wheel";          "with" = "unix.sysadmins"; }
      { local = "networkmanager"; "with" = "unix.workstations"; }
      { local = "video";          "with" = "unix.workstations"; }
    ];
  };

  # local system groups that map_group targets must exist locally:
  users.groups.wheel = { };
  users.groups.networkmanager = { };
  users.groups.video = { };
};
```

Then add `nixos.kanidm-client` to `nix-config/modules/hosts/nixos.nix`
`modules` list.

Package-version note: the client `kanidm` package **must match the server
major** (currently `_1_11`). Keep both referencing the same constant.

### 3.1 Client config/token distribution

`client.settings.uri` only needs the public idm URL + the root CA already
trusted via `security.pki.certificateFiles` (`_private/nixos/security.nix`
already imports `alford-root.crt`). No bearer token is needed for NSS
resolution of POSIX accounts; `kanidm-unixd` talks to the server anonymously
for id-mapping. Verify with `getent passwd <user>` after first deploy while
the server is reachable (first resolve requires connectivity; later resolves
are cached).

### 3.2 GDM / GNOME specifics

- GDM already enabled (`programs/gnome-desktop.nix`, `displayManager.gdm`).
  With `unix.enable`, `gdm-password` → `login` substack picks up the
  auto-wired `pam_kanidm` rule. No change to the gnome module required.
- **Keyring:** password login unlocks `gnome-keyring` normally. (The preplan's
  YubiKey/`pam_u2f` touch-login keyring caveat only applies if we add
  `pam_u2f` — which is out of scope here, see §3.3.)
- **gcr-ssh-agent is already disabled** (`services.gnome.gcr-ssh-agent.enable
  = false`) and the user uses `startAgent`/`IdentityAgent` — no interaction
  with the Kanidm change.

### 3.3 YubiKey at the greeter — out of scope

The preplan's §4/§5 `pam_u2f` mapfile is **deferred**. It adds lockout risk
(experimental rules API) and keyring friction for no benefit to the
`jacob → rae` migration. Revisit only after basic `rae` login is proven, and
prefer waiting for kanidm#1553 (FIDO2 in `kanidm-unixd`) so enrollment is
central rather than per-host mapfiles.

---

## 4. SSH — preserving step-ca and extending to servers

This is the constraint that matters most. Two **independent** pubkey sources
coexist on sshd; a session succeeds if either passes:

| Path               | sshd mechanism                                           | Where configured today         | Status             |
| ------------------ | -------------------------------------------------------- | ------------------------------ | ------------------ |
| step-ca user cert  | `TrustedUserCAKeys` (`c.ca.sshUserCaCert`)               | `services/openssh.nix`         | **Keep untouched** |
| Kanidm static keys | `AuthorizedKeysCommand` → `kanidm_ssh_authorizedkeys %u` | added by `unix.sshIntegration` | new, additive      |

### 4.1 Do not break step-ca (verification-first)

- `services/openssh.nix` sets `TrustedUserCAKeys = c.ca.sshUserCaCert`. Leave
  it. `unix.sshIntegration` adds an `AuthorizedKeysCommand`; it does **not**
  touch `TrustedUserCAKeys`.
- **Only the first `AuthorizedKeysCommand` wins.** Audit after deploy:
  `sshd -T | grep -iE 'authorizedkeyscommand|trustedusercakeys'` on each host
  to confirm exactly one command and the CA path intact.
- The `ssh-cert-renewer` host-cert flow and step-ca OIDC user-cert flow are
  orthogonal to NSS/unixd — no change.

### 4.2 Principal ↔ unix identity on destination servers (Phase 3)

For `step ssh` into augustus/cicero to land on the `rae` identity, the cert
**principal** (the Kanidm username `rae`, stamped by the step-ca `kanidm` OIDC
provisioner) must map to a login account on the destination:

- **If the destination also enables `kanidm-client` (unix.enable)**, the `rae`
  principal resolves via NSS to the Kanidm POSIX account directly — provided
  `rae` is in `pam_allowed_login_groups` there too. This is the clean path:
  add `nixos.kanidm-client` to the server hosts (augustus/cicero) in Phase 3,
  with an appropriate `pam_allowed_login_groups` (e.g. a `unix.servers` group
  distinct from `unix.workstations`).
- **During migration**, the servers still have local `jacob` with
  `openssh.authorizedPrincipals`. The step-ca cert authorizes by principal, so
  as the cert principal moves from `jacob` to `rae` the server-side
  authorization must move with it — either by adding `rae` to the Kanidm NSS
  path (preferred) or, transitionally, adding `rae` to the local account's
  `authorizedPrincipals`. Plan to retire the local `jacob` accounts on servers
  as the final step of Phase 3.

Sequencing: prove client on `nixos` (Phase 1) → migrate workstation off
`jacob` (Phase 2) → enable `kanidm-client` on servers behind a `unix.servers`
group and retire local `jacob` there (Phase 3), auditing `sshd -T` and
confirming both step-ca and Kanidm paths resolve at each step.

---

## 5. Home-Manager association

Current: `jacob@nixos` is a **standalone** `homeConfigurations` entry
(`modules/home/jacob-nixos.nix`) keyed by username `jacob`, home
`/home/jacob`. This already matches the preplan's "run HM separately, keyed by
the Kanidm POSIX username" recommendation — it just needs to be re-keyed to
`rae`.

- **Phase 1:** local `jacob` still owns `/home/jacob` and its HM profile is
  unchanged. `rae` logs in with a fresh Kanidm-owned home
  (`kanidm-unixd-tasks` creates `/home/<uuid>` + `/home/rae` symlink). You can
  optionally stand up a minimal `rae@nixos` HM profile now, or defer full HM
  content to Phase 2.
- **Phase 2 (retire `jacob` on `nixos`):**
  - Add a `rae@nixos` home config (new `modules/home/rae-nixos.nix`,
    `flake.homeConfigurations."rae@nixos"`) with `home.username = "rae"` and
    `home.homeDirectory = "/home/rae"` (the unixd SPN symlink). Port the
    contents of `jacob-nixos.nix` (ssh config, packages, etc.), updating the
    hardcoded `identityAgent = "/run/user/1000/ssh-agent"` and any `1000`
    references to `rae`'s uid (prefer the gidnumber pinned in
    `service-registry.nix`, or `/run/user/%U`-style resolution).
  - **First HM build for `rae` must run with the Kanidm server reachable** so
    `getent passwd rae` resolves.
  - Migrate per-user state into `/home/rae`: the sops age key
    (`~/.config/sops/age/keys.txt`), `~/.ssh/yk_ssh_keys/*`, `~/.step/*`. Until
    the age key is in place for `rae`, sops-nix on `nixos` (which reads
    `/home/jacob/.config/sops/age/keys.txt` per `_private/nixos/sops.nix`) must
    be re-pointed — update `sops.age.keyFile` to `rae`'s path as part of this
    phase.
  - Remove `users.users.jacob` from `_private/nixos/users.nix` and drop the
    `jacob@nixos` HM config. Do **not** add `users.users.rae` (that
    re-introduces the shadowing problem in §1.1).
  - Update `services.openssh.settings.AllowUsers` (`services/openssh.nix`
    defaults to `[ "jacob" ]`) to allow `rae`.

---

## 6. Phased execution checklist

**Phase 1 — add `rae` as a Kanidm POSIX login on `nixos` (local `jacob`
untouched, no step-ca regression). Ship first.**

- [ ] `service-registry.nix`: add `constants.unix` block (gidnumbers for
      `unix.workstations`, `unix.sysadmins`, and `rae`).
- [ ] `kanidm.nix`: add `unix.workstations` / `unix.sysadmins` groups; add
      `rae` to both; add `kanidm-posix-provision` to
      `failure-notifs.attachServices`.
- [ ] New `features/kanidm-posix/service.nix` — imperative POSIX enablement
      oneshot (augustus) for the groups and the `rae` person. Register in
      augustus host.
- [ ] New `features/kanidm-client/service.nix` — `unix.enable` +
      `sshIntegration` + `map_group` + local groups.
- [ ] `hosts/nixos.nix`: import `nixos.kanidm-client`.
- [ ] Deploy augustus first (POSIX enablement), then `nixos`.
- [ ] Verify: `getent passwd rae`, `sshd -T | grep -iE 'authorizedkeys|trusted'`
      (one command, CA intact), `step ssh` to augustus still works, GDM login
      **as `rae`** (test from a **second tty/live session** first — PAM lockout
      guard). Local `jacob` login must still work as the recovery path.

**Phase 2 — retire local `jacob` on `nixos`, cut over fully to `rae`.**

- [ ] New `modules/home/rae-nixos.nix` (`flake.homeConfigurations."rae@nixos"`)
      ported from `jacob-nixos.nix`, keyed to `rae` / `/home/rae`, uid/agent
      paths updated.
- [ ] Migrate per-user state into `/home/rae`: sops age key, `~/.ssh/yk_ssh_keys`,
      `~/.step`. Re-point `sops.age.keyFile` in `_private/nixos/sops.nix`.
- [ ] First `rae` HM build with the Kanidm server reachable.
- [ ] Update `AllowUsers` in `services/openssh.nix` to include `rae`.
- [ ] Remove `users.users.jacob` from `_private/nixos/users.nix`; drop
      `jacob@nixos` HM config. Never add `users.users.rae`.
- [ ] Re-verify greeter login as `rae` + keyring + step-ca + sops decryption.

**Phase 3 — extend `rae` to servers; retire local `jacob` there.**

- [ ] Add `unix.servers` group (declarative + POSIX hook) and add `rae`.
- [ ] Enable `kanidm-client` on augustus (then cicero/praeconinus) with
      `pam_allowed_login_groups = [ "unix.servers" ]`.
- [ ] Move the SSH cert principal authorization from `jacob` to `rae`
      (NSS-resolved `rae`, or transitional `authorizedPrincipals`).
- [ ] Audit `sshd -T`; confirm `rae` principal resolves to the Kanidm NSS
      account; then remove local `jacob` accounts per-host.

---

## 7. Validation (per `.kiro/steering/validation.md`)

New `.nix` files must be **git-added before any Nix eval** (flakes evaluate
the git tree):

```sh
git add -A
nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')
nix flake check
nix build .#nixosConfigurations.nixos.config.system.build.toplevel
nix build .#nixosConfigurations.augustus.config.system.build.toplevel
nix build .#checks.x86_64-linux.shellcheck   # the POSIX-provision script is a shell script
```

Runtime verification after deploy (can't be done in CI):

```sh
# on nixos (server reachable):
getent passwd rae
getent group  unix.workstations
systemctl status kanidm-unixd
sshd -T | grep -iE 'authorizedkeyscommand|authorizedkeyscommanduser|trustedusercakeys'
# step-ca still good:
step ssh login / existing proxycommand flow to augustus
```

**Lockout guard:** before relying on Kanidm for the greeter, keep a known-good
generation bootable, keep local `jacob` as a recovery login until Phase 2
completes, and test `rae` login from a second TTY / live session.

---

## 8. Risks & mitigations

| Risk                                                  | Mitigation                                                                                                                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PAM misconfig locks out the workstation               | Rely on auto-wired `pam_kanidm` (no hand-written rules); test from 2nd TTY; keep rollback generation and local `jacob` as recovery until Phase 2. step-ca SSH remains an independent recovery path. |
| sops age key lives in `/home/jacob`                   | §1.1/§5: migrate the age key into `/home/rae` and re-point `sops.age.keyFile` **before** removing local `jacob`; verify sops decryption post-migration.                                             |
| Losing step-ca/ssh keys during home migration         | Copy (don't move) `~/.ssh/yk_ssh_keys`, `~/.step`, age key into `/home/rae`; verify `step ssh` + sops before deleting `/home/jacob`.                                                                |
| Second `AuthorizedKeysCommand` clobbers step-ca audit | `sshd -T` audit gate in checklist; only `unix.sshIntegration` sets it.                                                                                                                              |
| POSIX attrs drift (manual CLI)                        | Single idempotent oneshot; gidnumbers pinned in `service-registry.nix`.                                                                                                                             |
| First HM/NSS resolve needs server online              | Documented; first `rae` login/HM build needs connectivity; cache covers later offline use.                                                                                                          |
| Client/server kanidm major mismatch                   | Both reference the same `kanidmWithSecretProvisioning_1_11` constant.                                                                                                                               |
| step-ca TLS/SSH regression                            | No step-ca files touched; explicit post-deploy verification of issuance + renewer.                                                                                                                  |
| Server login breaks as principal moves `jacob`→`rae`  | Phase 3 moves authorization before removing local `jacob`; keep `authorizedPrincipals` transitional overlap.                                                                                        |

---

## 9. Open questions to confirm before coding

1. gidnumber allocation band — confirm `65536–524287` and the specific numbers
   to pin for `unix.workstations`, `unix.sysadmins`, and `rae` in
   `service-registry.nix`.
2. Scope now: Phase 1 only (add `rae` alongside `jacob`), or carry through
   Phase 2 (retire local `jacob` on `nixos`) in the same pass?
3. Login shell for the `rae` POSIX account — `zsh` (matches current)?
4. The `rae` home: keep the human-facing `/home/rae` SPN symlink (recommended),
   accept the real `/home/<uuid>` dir underneath?
5. Retiring the **Kanidm `jacob` person** (separate from the local unix
   `jacob`): it still carries OIDC group memberships (step-ca, grafana, etc.).
   Is consolidating those onto `rae` and removing the `jacob` person in scope,
   or a later cleanup? (The local unix `jacob` removal in Phase 2 does not
   require touching the Kanidm `jacob` person.)
