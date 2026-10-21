# Kanidm on NixOS: Unix Users, GNOME Login, and Home-Manager

Planning document for running NixOS workstations whose users are provisioned
entirely by Kanidm, with GNOME (GDM) desktop login, optional YubiKey touch as
an alternate factor, and SSH via both step-ca short-lived certificates and
Kanidm-managed static keys.

Verified against current nixpkgs (PAM rules API is **experimental** — re-check
after major upgrades).

---

## 1. Goals and architecture

**Goal:** a user created in Kanidm can log in at the GDM greeter on any
workstation — typing the Kanidm username plus password, or blank password plus
a YubiKey touch — with no per-machine `users.users` declaration, and with
Home-Manager managing their dotfiles.

```
+---------------+    oidc / pam+nss     +-----------------------------+
|   Kanidm      | <-------------------- |   NixOS client              |
|   server      |                       |   kanidm-unixd  (NSS)       |
|   POSIX       |                       |   pam_kanidm    (auth)      |
|   accounts    |                       |   pam_u2f       (YubiKey)   |
+-------+-------+                       |   sshd (2 key paths)        |
        |  OIDC (step-ca trigger)       |   gnome-shell + home-manager|
+-------v-------+   short-lived certs   +-----------------------------+
|    step-ca    | ------------------------>  remote servers
+---------------+        TrustedUserCAKeys
```

### Identity ownership — the one rule that matters

| Concern                                             | Owner                                    |
| --------------------------------------------------- | ---------------------------------------- |
| Identity, UID/GID numbers, POSIX groups             | Kanidm                                   |
| Local system groups + membership (`wheel`, `video`) | NixOS `users.groups` + unixd `map_group` |
| Home directory creation/ownership                   | `kanidm-unixd-tasks` (not NixOS, not HM) |
| Per-user config / dotfiles                          | Home-Manager (standalone flake)          |
| SSH short-lived auth                                | step-ca (OIDC via Kanidm)                |
| SSH static / offline auth                           | Kanidm (`sshIntegration`)                |

**Hard rule: never declare Kanidm-managed users in `users.users`.**
It looks tempting (Home-Manager's NixOS module wants it, see §6), but it
breaks subtly:

1. **Double identity.** unixd conflicts with local entries: when a name
   exists in both `/etc/passwd` and Kanidm, the local entry silently wins
   (Kanidm's is ignored unless listed in `allow_local_account_override`,
   which is discouraged). You end up with one username resolving to two
   different UIDs depending on code path — local uid ~1000 via NSS,
   ~1.9 billion via PAM's view.
2. **Two home-directory managers.** NixOS activation and `kanidm-unixd-tasks`
   would both own `/home/<user>` with different layouts.
3. **Rename attack surface.** Kanidm users can rename themselves; combined
   with `allow_local_account_override` that can be a path to impersonating a
   locally-defined account (e.g. `root`).
4. **Group mismatch.** Kanidm accounts store only a `gidnumber` that doubles
   as their UID, so local `users.groups` entries for them don't map onto
   anything, and reflecting local group GIDs into Kanidm across hosts with
   different GIDs corrupts the other side.

### How Kanidm assigns Unix IDs

- Every **person** account needs POSIX attributes
  (`kanidm person posix add/set ...`) to appear in NSS at all.
- An account stores a single `gidnumber` — used as **both** UID and GID;
  the private group is synthesized on the fly, so UID/GID can't drift.
- Allocation:
  | Method                 | Range / rule                                                                                                   |
  | ---------------------- | -------------------------------------------------------------------------------------------------------------- |
  | Dynamic (default)      | last 24 bits of the account UUID → `1879048192`–`2147483647` (kernel/systemd reserve the rest)                 |
  | Explicit `--gidnumber` | recommended `65536`–`524287`; leave `1000`–`65535` for OS use; for >2000 users, consider an external allocator |
- Groups: `kanidm group posix set <group> --gidnumber N`. A POSIX-enabled
  group's membership is its POSIX membership (no separate membership type).
- Client side, `kanidm-unixd` resolves and **caches** entries locally (that
  's what keeps login working through network outages), serves NSS, and
  `kanidm-unixd-tasks` creates homes: layout is `<home_prefix>/<uuid>`
  (default `/home/`, keyed on UUID by default) with a symlink
  `/home/<spn>` — and it **is** what NSS reports as the home path. `/etc/skel`
  population is **off** by default.

---

## 2. Server setup (once, per deployment)

```bash
# Groups needed on the client side
kanidm group posix add workstations \
  --description "daily-use workstation login" \
  --gidnumber 55001
kanidm group posix add sysadmins \
  --gidnumber 55002

# People
kanidm person posix add alice \
  --gidnumber 56001 \
  --shell /usr/bin/zsh
#   (...or omit --gidnumber for dynamic allocation)

kanidm group workstations member add alice
```

- Every person must have POSIX enabled or it won't resolve in NSS.
- A user must belong to at least one group that the client lists in
  `pam_allowed_login_groups` or login is refused (checked inside
  `pam_kanidm`, independent of the PAM stack lines).
- **YubiKey passkeys** (`kanidm auth passkey new` or web UI) can be enrolled
  per account today — Kanidm passkeys are OIDC credentials. They are **not
  yet** consumed by `kanidm-unixd`/PAM for desktop login (tracked as
  kanidm/kanidm#1553, open); see §5.
- SSH static keys for the offline path: add to the person record
  (`kanidm person set alice <pubkey> --name workstation`). Needed only for
  the `kanidm_ssh_authorizedkeys` flow; optional if step-ca covers SSH.

OIDC for step-ca: register step-ca's SSH client as an OIDC client in Kanidm
(scope `openid email profile`-ish, device/browser flow enabled). The Kanidm
username is stamped into the resulting SSH certificate's principal.

---

## 3. Client: NixOS base config

```nix
{ config, pkgs, ... }: {
  networking.hostName = "client";
  networking.hostId   = "de:ad:be:ef:01";   # stable, needed by kanidmd if co-hosted

  # --- Only if kanidmd runs on THIS host:
  # services.kanidm.server.enable = true;  (+ db, realm, etc., per module)

  # --- Client: NSS daemon + unixd-tasks (home creation) ---
  services.kanidm.package = pkgs.kanidm;
  services.kanidm.client.settings.uri = "https://id.example.com";
  services.kanidm.unix.enable = true;       # modern name; supersedes enablePam
  services.kanidm.unix.settings = {
    version = 2;
    kanidm = {
      # Login-gate: user must be in one of these (name, SPN, or UUID)
      pam_allowed_login_groups = [ "workstations" ];

      # Extend local groups with Kanidm POSIX groups (Kanidm >= 1.4):
      map_group = [
        { local = "video";             with = "workstations"; }
        { local = "networkmanager";    with = "workstations"; }
        { local = "wheel";             with = "sysadmins"; }
      ];
    };
  };

  # --- SSH: Kanidm-managed keys (offline/static path) ---
  services.kanidm.unix.sshIntegration = true;
}
```

What the module gives you (and what it does **not**):

- **Yes:** `kanidm-unixd.service` + tasks daemon; `libnss_kanidm` inserted
  into `nssDatabases.passwd`/`.group` (before `files`); `/etc/kanidm/config`
  - `/etc/kanidm/unixd`; for `sshIntegration`, a system user
    `kanidm-authorized-keys`, a root-owned wrapper script, and
    `AuthorizedKeysCommand` / `AuthorizedKeysCommandUser` on the sshd config.
- **No:** PAM. The module wires **no** PAM rules — all PAM lines are yours
  (§4).

`map_group` is the replacement for the old "put Kanidm users into local
groups" pain: instead of `users.users.<kani-user>.extraGroups = [ "video" ]`,
one line per (local group, Kanidm group) pair, and membership follows the
Kanidm group from then on.

### sshd coexistence with step-ca (no conflict)

Two independent pubkey sources, evaluated separately — a session succeeds if
either works:

| Path        | sshd hook                                                     | Works when                            |
| ----------- | ------------------------------------------------------------- | ------------------------------------- |
| step-ca     | `TrustedUserCAKeys` file (+ optional `principals=` / `Match`) | CA + Kanidm OIDC reachable            |
| Kanidm keys | `AuthorizedKeysCommand` → `kanidm_ssh_authorizedkeys %u`      | keys cached by unixd — **offline OK** |

Recommended sshd settings (your existing step-side config stays untouched —
the step-ca NixOS module configures no sshd options):

```
TrustedUserCAKeys /etc/ssh/trusted_cas/step-ca.pub

# Optional tightening, keyed on the Kanidm username principal:
Match CertificatePrincipal alice
  ForceCommand internal-sftp
Match CertificatePrincipal *
  # default policy
```

Caveats:

- **Only the first `AuthorizedKeysCommand` is honored.** Don't add
  another one in `openssh.extraConfig` or another module. Audit with
  `sshd -T | grep -iE 'authorizedkeys|trusted'`.
- Test locally: `kanidm_ssh_authorizedkeys alice` should print the key.
- Kanidm has no SSH CA feature yet (maintainers: static key distribution
  first, CA "a while away"). Expect to keep step-ca; when/if a Kanidm CA
  lands, you remove one path, not both.

---

## 4. Client: PAM for GDM / GNOME

GDM's login dialog authenticates under service **`gdm-password`**, which
(current nixpkgs) substacks **`login`**. Put the rules on `login`, then read
`/etc/pam.d/gdm-password` after activation to confirm.

> `security.pam.services.*.rules` is officially **experimental** in current
> nixpkgs: it's structured as
> `rules.<stack>.<rule> = { control, modulePath, args, order }` with
> `useDefaultRules` controlling the default prelude. A typo can be a lockout
> — test login from a second (live/tty) session before relying on it, and
> keep a known-good generation bootable.

```nix
{ config, lib, pkgs, ... }: {
  environment.etc.u2f.text = ''
    # pam_u2f mapfile: <kanidm-username> <key-id> <base64-pubkey>
    alice <key-id-1> <base64-pubkey-1>
    bob   <key-id-2> <base64-pubkey-2>
  '';
  environment.etc.u2f.owner = "root";
  environment.etc.u2f.group = "root";
  environment.etc.u2f.permissions = "0400";

  security.pam.services.login.rules = {
    auth.kanidm = {
      order      = lib.mkBefore 1000;   # or a concrete number above the stack
      control    = "sufficient";
      modulePath = "${pkgs.kanidm}/lib/security/pam_kanidm.so";  # ls to confirm
      args = [ "ignore_unknown_user" ];
    };
    # YubiKey touch — alternate factor (key OR password)
    auth.u2f = {
      order      = lib.mkAfter 1000;
      control    = "sufficient";
      modulePath = "${pkgs.pam-u2f}/lib/security/pam_u2f.so";
      args = [ "mapfile=/etc/u2f/mapfile" ];
    };
    account.kanidm = {
      control    = "sufficient";
      modulePath = "${pkgs.kanidm}/lib/security/pam_kanidm.so";
      args = [ "ignore_unknown_user" ];
    };
    session.kanidm = {
      control    = "optional";
      modulePath = "${pkgs.kanidm}/lib/security/pam_kanidm.so";
    };
  };
}
```

Behavior: username at the greeter, then either the Kanidm password **or** a
YubiKey tap. Requiring _both_ in one session is possible but a fiddly
`succeed_if` dance; most setups ship key-as-alternate.

GNOME-specific notes:

- **Keyring:** `pam_u2f` authenticates via zero-knowledge proof — no password
  exists in the PAM environment on a touch-only login, so
  `gnome-keyring-daemon` cannot auto-unlock the login keyring (known
  `pam-u2f` limitation). Mitigations: unlock manually, set a keyring PIN, or
  keep password-primary. Fine for most use; decide per user.
- Place `auth.u2f` **after** the password modules; pre-empting them can make
  the password field in the greeter misbehave.

---

## 5. YubiKey at the GDM login

**Today:** `pam-u2f` with a FIDO2 _static_ credential. Per-host registration
(the main operational cost); the key is bound to the username string, not to
the Kanidm account.

Per new key:

```bash
ykman accounts create -n alice        # on the host; shows key-id + pubkey
# append: alice <key-id> <base64-pubkey>  to that host's /etc/u2f/mapfile
```

Note the asymmetry: the _server-side_ passkey (enrollable in Kanidm today)
secures the step-ca OIDC session (`step` browser flow) and web login; the
_PAM-side_ key is the `pam-u2f` mapfile entry. When kanidm/kanidm#1553 lands
(FIDO2 in `kanidm-unixd` PAM), the mapfile disappears — the user enrolls the
YubiKey as a passkey in Kanidm, `pam_kanidm.so` lines stay as written, and
key registration becomes one-time and central. Until then both coexist fine
and cover different hopscotch (desktop vs. OIDC).

Combined chain: YubiKey passkey → Kanidm OIDC → step-ca short-lived SSH cert
→ sshd. Hardware MFA at the identity boundary, cert expiry at the SSH
boundary.

---

## 6. Home-Manager as a standalone flake

**Why not `home-manager.users` from the NixOS module:** HM's NixOS module
asserts its users exist in `users.users` (exactly one of `isSystemUser` /
`isNormalUser`, group constraints), which Kanidm-provided users can't
satisfy — nix-community/home-manager#5244 ("Home manager with non-local
users", open, affects Kanidm/SSSD/AD alike). Defining the local user "to fix
it" re-introduces every problem in §1.

**Run HM separately**, keyed by the Kanidm POSIX username:

```nix
# flake.nix — HM portion, separate profile from the system
{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";  # pin deliberately

  outputs = { nixpkgs, home-manager, ... }: {
    homeConfigurations = lib.genAttrs [ "alice" "bob" ] (u:
      home-manager.lib.homeManagerConfiguration {
        pkgs = import nixpkgs { system = "x86_64-linux"; };
        extraSpecialArgs = { username = u; };
      });
  };
}

# home.nix (per user, or parameterized)
{ pkgs, ... }: {
  home.username = "alice";             # Kanidm SPN/POSIX name
  home.homeDirectory = "/home/alice";  # the spn symlink unixd-tasks made
  home.stateVersion = "25.05";

  programs.git = { enable = true; ... };
  services.gpg-agent.enable = true;
  # ...packages, apps, files
}
```

Operational notes:

- **First build per user:** `kanidm-unixd` must be running _and_ the server
  reachable, so the HM build resolves the user through NSS
  (`getent passwd alice`). Afterwards rebuilds are uneventful, including
  offline (cached entries).
- **Do not** let NixOS/HM create homes or the accounts: no
  `users.users.alice`, no `home.packages`-triggered home creation;
  `kanidm-unixd-tasks` owns the directory, UUID-named with an SPN symlink.
  (If you want `/etc/skel` contents, either turn that on in the unixd-tasks
  settings or ship an initial setup via HM file-owners)
- Keying by username rather than UUID is fine; unixd does resolve UUIDs as
  unique identifiers too (`getent passwd <uuid>` works), so a UUID-keyed
  variant is viable if you prefer the stable identity. Prefer symlinks:
  usernames are what humans and `Match CertificatePrincipal` use.
- Renames in Kanidm are breaking-change events walking every machine (see §8)

---

## 7. Full client config assembly (reference)

```nix
{ config, lib, pkgs, ... }: {
  imports = [];

  networking.hostName = "client";
  networking.hostId   = "de:ad:be:ef:01";

  # ---------- identity ----------
  services.kanidm.package = pkgs.kanidm;
  services.kanidm.client.settings.uri = "https://id.example.com";
  services.kanidm.unix.enable = true;
  services.kanidm.unix.settings = {
    version = 2;
    kanidm = {
      pam_allowed_login_groups = [ "workstations" ];
      map_group = [
        { local = "video";            with = "workstations"; }
        { local = "networkmanager";   with = "workstations"; }
        { local = "wheel";            with = "sysadmins"; }
      ];
    };
  };

  # ---------- PAM (see §4 for caveats) ----------
  security.pam.services.login.rules = {
    auth.kanidm    = { order = lib.mkBefore 1000; control = "sufficient";
                       modulePath = "${pkgs.kanidm}/lib/security/pam_kanidm.so";
                       args = [ "ignore_unknown_user" ]; };
    auth.u2f       = { order = lib.mkAfter 1000;  control = "sufficient";
                       modulePath = "${pkgs.pam-u2f}/lib/security/pam_u2f.so";
                       args = [ "mapfile=/etc/u2f/mapfile" ]; };
    account.kanidm = { control = "sufficient";
                       modulePath = "${pkgs.kanidm}/lib/security/pam_kanidm.so";
                       args = [ "ignore_unknown_user" ]; };
    session.kanidm = { control = "optional";
                       modulePath = "${pkgs.kanidm}/lib/security/pam_kanidm.so"; };
  };
  environment.etc.u2f = { text = ''alice <key-id> <base64-pubkey>'';
                          owner = "root"; group = "root"; permissions = "0400"; };

  # ---------- SSH ----------
  services.kanidm.unix.sshIntegration = true;
  services.openssh.settings = {
    TrustedUserCAKeys = [ "/etc/ssh/trusted_cas/step-ca.pub" ];
    # optional: Match CertificatePrincipal ... policy blocks
  };

  # ---------- local groups only ----------
  users.groups = { wheel = { }; video = { }; networkmanager = { }; };
}
```

---

## 8. Operations

### Onboarding a new user

1. `kanidm person posix add <user> --gidnumber N --shell ...`
2. Add to `workstations` (`kanidm group workstations member add <user>`)
3. YubiKey: enroll Kanidm passkey (web UI) for OIDC/step-ca
4. Per workstation: `ykman accounts create -n <user>` → append line to that
   host's `/etc/u2f/mapfile`
5. SSH static key (optional): `kanidm person set <user> <pubkey> --name ...`
6. First HM build on _one_ machine with the unixd running and server
   reachable; after that, the profile build works anywhere

### Renames / rollovers

Kanidm user rename touches, per host: `/etc/u2f/mapfile` (or re-create the
registration), the HM flake key, any `Match`/`principals=` ssh ACLs, and the
`/home/<name>` symlink is re-sorted by unixd-tasks (the UUID home dir is
stable, but re-verify). Prefer stable local names or accept the walk.

### Drift to watch

- **Explicit `gidnumber` collisions** across clusters feeding one Kanidm
  realm — pick one allocation range, document it.
- **`pam_allowed_login_groups` values** — use names (or SPNs), not UUIDs you
  can rename; failures surface as a bland "authentication failed" from PAM.
- **PAM rules API churn** across NixOS releases — re-read
  `/etc/pam.d/{login,gdm-password}` after upgrades.
- **Double `AuthorizedKeysCommand`** sneaking in via third-party modules —
  `sshd -T` audit.

### Debugging map

| Symptom                                                                                | First checks                                                                                    |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `getent passwd` misses user                                                            | unixd running? POSIX attributes on the account? Name collides with local `/etc/passwd`?         |
| Login rejected, credentials OK elsewhere                                               | Membership in `pam_allowed_login_groups`; wrong `uri` / TLS; `journalctl -u kanidm-unixd`       |
| Home looks "empty"                                                                     | Expected layout: real dir is `/home/<uuid>`, `/home/<name>` is symlink; skeleton off by default |
| `kanidm-unixd-tasks` failing                                                           | unixd/auth token offline; usually self-heals                                                    |
| SSH `Permission denied (publickey)` but `kanidm_ssh_authorizedkeys <user>` prints keys | Second `AuthorizedKeysCommand` overriding (first wins); check `sshd -T`                         |
| `step ssh fetch` fails                                                                 | OIDC side, not sshd — check step-ca client, Kanidm auth flow, cert discovery                    |
| GDM doesn't see user                                                                   | unixd up at greeter start? NSS cache cold + server down? Restart `kanidm-unixd`                 |
| Keyring doesn't unlock after touch login                                               | Known `pam-u2f` ZKP limitation (§4) — manual unlock / PIN                                       |

---

## 9. Known gaps (revisit)

| Gap                                                      | Where                                                                                               | What changes when it lands                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| FIDO2/WebAuthn in `kanidm-unixd` PAM                     | [kanidm/kanidm#1553](https://github.com/kanidm/kanidm/issues/1553) (open)                           | Delete `/etc/u2f/mapfile` + `pam-u2f`; enroll keys as Kanidm passkeys; `mapfile`/per-host YubiKey registration goes away |
| Kanidm SSH CA (certificates instead of key distribution) | maintainer "in the planning stages"                                                                 | Could replace or complement step-ca; remove whichever cert path is redundant                                             |
| HM NixOS module with non-local users                     | [nix-community/home-manager#5244](https://github.com/nix-community/home-manager/issues/5244) (open) | Could (re)move HM profiles into the system flake                                                                         |
| nixpkgs PAM rules API                                    | `security.pam.services.*.rules` (experimental)                                                      | Re-audit config wording on stabilization                                                                                 |

## 10. References

- Kanidm PAM/NSS integration: <https://kanidm.github.io/kanidm/stable/integrations/pam_and_nsswitch.html>
- Kanidm SSH integration: <https://kanidm.github.io/kanidm/stable/integrations/ssh_integration.html>
- nixpkgs Kanidm module: <https://github.com/NixOS/nixpkgs/blob/master/nixos/modules/services/security/kanidm.nix>
- nixpkgs PAM module (rules API): <https://github.com/NixOS/nixpkgs/blob/master/nixos/modules/security/pam.nix>
- pam-u2f: <https://github.com/Yubico/pam-u2f>
- Disourse: YubiKey GNOME login on NixOS: <https://discourse.nixos.org/t/how-to-enable-yubikey-login-to-gnome/43402>
- Discourse: non-local users & system groups: <https://discourse.nixos.org/t/dealing-with-non-local-users-and-system-groups-home-manager/29145>
