# habitsync — Service Consolidation Plan

Status: **PROPOSED** · Host: **augustus** · Concerns: **V O** · Complexity: **low**

Module: `nix-config/modules/services/habitsync.nix`

> Governed by the [operational-equivalence rule](./README.md): deploying this revision must be a
> theoretical **no-op**. The migration moves _where_ config is declared (into `features/habitsync/`
> catalog + generators), not _what_ augustus realizes. Nothing below changes runtime behavior.

## 1. Current emitted output (verbatim)

HabitSync is an **app-gated OIDC** reverse-proxy service with a **public** Kanidm client (PKCE, no
secret) whose `originUrl` is a **list** — including a non-HTTP custom-scheme callback for the mobile
app. Registry facts (`constants.services.habitsync`): `subdomain = "habitsync"`, `port = 6842`,
`clientId = "habitsync"`, `stateDir = "/var/lib/habitsync"`, so `svc.url =
"https://habitsync.plato-splunk.media"`.

### 1.1 Caddy vhost — `services.caddy.virtualHosts."https://habitsync.plato-splunk.media"`

The module sets `extraConfig` to (note the source uses `127.0.0.1`, not `localhost`):

```caddy
reverse_proxy 127.0.0.1:6842
```

There is **no** `security.acme.certs` entry — the vhost shares Caddy's managed cert
(`tls.cert.shared = { }`). No mTLS, no Caddy-level auth. (Byte note: the upstream token is `127.0.0.1` here — the
renderer standardizes on `127.0.0.1` globally, so this vhost is byte-identical with **no** deviation,
unlike `it-tools`/`openwebui`/`planka`/`home-assistant` which get the approved `localhost → 127.0.0.1`
substitution. See [catalog-and-generators §7.8 #22](./catalog-and-generators.md).)

### 1.2 Kanidm OIDC — `services.kanidm.provision.systems.oauth2."habitsync"`

Full block emitted today (**public** client, list `originUrl`):

```nix
services.kanidm.provision.systems.oauth2."habitsync" = {
  public = true;

  originUrl = [
    "https://habitsync.plato-splunk.media/auth-callback"
    "habitsync://auth-callback"
  ];
  originLanding = "https://habitsync.plato-splunk.media";
  displayName = "HabitSync";

  scopeMaps."habitsync.access" = [
    "openid"
    "profile"
    "email"
  ];
};
```

The genuinely service-specific parts are: `public = true` (PKCE, no `basicSecretFile`); the **list**
`originUrl` with two callbacks — a standard web one (`<url>/auth-callback`) and a **custom-scheme**
mobile one (`habitsync://auth-callback`) that is **absolute** (not derivable from `url +
callbackPath`); the `originLanding` with **no trailing slash** (`<url>`, not `<url>/`); and the
`scopeMaps` (`habitsync.access` → openid/profile/email). No `claimMaps` (role handling is app-side).

### 1.3 Non-networking config that stays in `service.nix` (verbatim-moved)

- The `oci-containers.containers.habitsync` block (`ghcr.io/jofoerster/habitsync:latest`, host
  networking, the `/data` + CA/truststore volume mounts, the `SPRING_*` / `APP_SECURITY_*` env, the
  `JAVA_TOOL_OPTIONS` truststore wiring).
- The postgres provisioning (`ensureDatabases`, `ensureUsers`, `users.groups.habitsync-db-pass`,
  `services.peesequel.provisionPasswords.habitsync`).
- The `habitsync` user/group (uid/gid 6842), `systemd.tmpfiles` for the data dir.
- The `sops.templates."habitsync-env"` secret template.
- The `services.restic.backups.habitsync` block.
- `services.failure-notifs.attachServices = [ "podman-habitsync" "restic-backups-habitsync" ]` —
  tied to the systemd unit, **stays in the feature**, never in the catalog.

## 2. Target catalog entry + feature layout

```
features/habitsync/
├── catalog.nix   # homelab.catalog.habitsync (networking contract below)
├── service.nix   # §1.3 container/db/user/sops/restic + failure-notifs
├── oidc.nix      # service-specific OIDC fields fed into the catalog entry (or inline in catalog.nix)
└── complete.nix  # nixos.habitsync = { imports = [ habitsync-catalog habitsync-service … ]; }
```

`catalog.nix`:

```nix
homelab.catalog.habitsync = {
  subdomain = "habitsync";
  zone = "plato-splunk.media";
  host = "augustus";
  backend.reverseProxy.port = 6842; # renderer uses 127.0.0.1 globally — matches the source exactly
  tls.cert.shared = { }; # shares Caddy's managed cert; no own cert
  access.scope.tailnet = { };
  dns.tailnet = { };
  oidc = {
    clientId = "habitsync"; # = name; explicit for clarity
    client.public = { };
    # list of callbacks; the second is absolute (custom scheme) — see schema gap #14
    originUrl = [
      "https://habitsync.plato-splunk.media/auth-callback"
      "habitsync://auth-callback"
    ];
    landingPath = ""; # originLanding = url + "" = bare origin (NO trailing slash) — see gap #12
    displayName = "HabitSync";
    scopeMaps."habitsync.access" = [ "openid" "profile" "email" ];
  };
};
```

## 3. Operational-equivalence argument (per surface)

- **Caddy vhost.** The caddy generator renders `reverse_proxy 127.0.0.1:6842` for
  `https://habitsync.plato-splunk.media` — byte-identical to §1.1 (the renderer's global `127.0.0.1`
  matches the source). No cert, no gate → same as today.
- **OIDC client.** The oidc generator (augustus) must reproduce `oauth2."habitsync"` exactly:
  `public = true` (no `basicSecretFile`), the **list** `originUrl` with the absolute
  `habitsync://auth-callback` entry preserved verbatim (schema gap #14), `originLanding =
  "https://habitsync.plato-splunk.media"` with **no** trailing slash (`landingPath = ""`, schema gap
  #12 — the generator must not force `/`), `displayName = "HabitSync"`, and `scopeMaps` order-preserved
  (gap #15). No `claimMaps`.
- **DNS.** `habitsync.plato-splunk.media` A/AAAA (augustus tailnet IP) is produced by the dns
  generator from `host = "augustus"` + `dns.tailnet`, reproducing the current `tailnetRewrites.habitsync
  = "augustus"` record. See [dns-records.md](./dns-records.md).
- **Firewall.** No change — `443` on `tailscale0` is already open and shared by all augustus vhosts.
- **Container / db / backups / failure-notifs.** Moved verbatim into `service.nix`; unchanged.

## 4. Parity gate

Stage new files first (`git add` — flake eval reads the git tree), then before/after:

```sh
# OIDC client — the list originUrl + no-trailing-slash landing are the risky bits
nix eval '.#nixosConfigurations.augustus.config.services.kanidm.provision.systems.oauth2."habitsync"' --json | jq -S .

# Caddy vhost body — must be byte-identical
nix eval '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."https://habitsync.plato-splunk.media".extraConfig' --raw

# Container + backups unchanged (spot check)
nix eval '.#nixosConfigurations.augustus.config.virtualisation.oci-containers.containers.habitsync' --json | jq -S .
```

Each before/after pair must diff empty. The `oauth2."habitsync"` JSON is the one to scrutinize: a
dropped list entry, a normalized trailing slash on `originLanding`, or reordered `scopeMaps` would
each be a (disallowed) behavior change.

## 5. Migration checklist

- [ ] Create `features/habitsync/{catalog.nix,service.nix,oidc.nix,complete.nix}`.
- [ ] Move the container/db/user/sops/restic/failure-notifs blocks verbatim into `service.nix`.
- [ ] Write the `homelab.catalog.habitsync` entry (§2); set `client.public = { }`, the list `originUrl`,
      `landingPath = ""`. (Upstream is `127.0.0.1` via the renderer — no per-entry field.)
- [ ] Register `nixos.habitsync` in `complete.nix`; keep it imported by `hosts/augustus.nix`.
- [ ] Confirm generator support for schema gaps #12 (empty landingPath), #14 (absolute list
      `originUrl`), #15 (scopeMap order) is in place first.
- [ ] Delete the old `services/habitsync.nix` in the same commit that flips `managedBy.*`.
- [ ] `git add` new files; run the §4 parity gates (empty diffs); `nix flake check`; build augustus.
