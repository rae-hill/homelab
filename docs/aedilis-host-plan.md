# Aedilis Host Plan — Technitium DNS on OVHCloud VPS

Status: **planning** (nothing implemented yet)

> **Role change (2026-10-13):** aedilis has been re-scoped from a public **authoritative**
> nameserver to a personal **recursive resolver**. It no longer serves plaintext DNS on the public
> internet: port 53 (udp+tcp) is **closed at the public firewall** and reachable only over
> Tailscale. Recursion is now **open to any client** (`DNS_SERVER_RECURSION=Allow`), but publicly
> only over the encrypted transports (DoH/DoT/DoQ), with per-client QPM rate limiting as the primary
> abuse control. Sections below describing authoritative behaviour / public plain 53 / recursion
> ACLs are retained for history but superseded by this note (see §7a/§7b for the updated rationale).
> Future authoritative DNS infrastructure will live on separate VPS hosts.

`aedilis` is a new single-purpose NixOS host running [Technitium DNS Server](https://github.com/TechnitiumSoftware/DnsServer) on an OVHCloud VPS. It serves encrypted DNS (DoH/DoT/DoQ) publicly as a recursive resolver, plain DNS over Tailscale for personal devices, exposes an SSO-gated admin UI over Tailscale, and ships metrics/logs back to the augustus observability stack.

---

## 1. Architecture Overview

```
Public internet ──► 443 (DoH)                    → Technitium (native TLS, recursion open)
                └─► 853/tcp (DoT), 853/udp (DoQ) → Technitium (native TLS, recursion open)
                  ✗ 53/udp, 53/tcp                → CLOSED to the public (firewalled)

Tailscale only ──► 53/udp, 53/tcp                → Technitium (plain DNS for personal devices)
                └─► dns-admin  (OIDC/SSO)         → Caddy ─► Technitium :5380 (admin UI)
                └─► dns-metrics (mTLS)            → Caddy ─► Technitium /api/dashboard/metrics/text (bearer)
                └─► Alloy ships journald logs     → augustus Loki push endpoint (mTLS client cert)

OIDC/SSO:  admin UI ──► Kanidm (idm.plato-splunk.media) via DNS_SERVER_SSO_* env vars
Certs:
  - Public endpoints (dns.plato-splunk.media)  ──► Let's Encrypt (public ACME)
  - Internal endpoints (dns-admin, dns-metrics) ──► step-ca (cicero) internal ACME
Metrics scrape: augustus Prometheus ──► dns-metrics (mTLS + shared bearer API token)
```

### Subdomains (confirmed)

| Name                             | Exposure        | Purpose                                  | TLS source    |
| -------------------------------- | --------------- | ---------------------------------------- | ------------- |
| `dns.plato-splunk.media`         | Public          | DoH (`/dns-query`), DoT (853), DoQ (853) | Let's Encrypt |
| `dns-admin.plato-splunk.media`   | Tailscale, mTLS | Technitium web admin UI (+ OIDC login)   | step-ca       |
| `dns-metrics.plato-splunk.media` | Tailscale, mTLS | Prometheus metrics endpoint              | step-ca       |

Plain DNS (53/tcp + 53/udp) is firewalled off the public internet and reachable only over Tailscale
for personal devices. Public clients use the encrypted transports (DoH/DoT/DoQ).

---

## 2. Key Technical Constraints

These shape the whole design and must be understood before implementing.

### 2.1 Technitium env vars bootstrap FIRST-BOOT config only

Per the [Docker environment variables docs](https://github.com/TechnitiumSoftware/DnsServer/blob/master/DockerEnvironmentVariables.md):

> These environment variables are read by the DNS server only when the DNS config file does not exist, i.e. when the DNS server starts for the first time.

Implication: our Nix module **bootstraps** initial state via env vars. Changes made later in the UI/API persist in the state directory and are **not** re-reconciled from Nix. The wrapper is a bootstrap, not a continuous reconciler. This limitation must be documented in the module and understood operationally (e.g. to re-apply env config, the state dir must be wiped — destructive).

### 2.2 Protocol handling split

| Protocol  | Port       | How it's terminated                                                    | Declarative?                                                                |
| --------- | ---------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Plain DNS | 53 udp/tcp | Technitium directly                                                    | Yes (recursion ACL via env var)                                             |
| DoH       | 443        | Caddy terminates TLS → proxies to Technitium `:80` plaintext DoH       | Yes (`DNS_SERVER_OPTIONAL_PROTOCOL_DNS_OVER_HTTP=true` + Caddy vhost)       |
| DoT       | 853 tcp    | Technitium terminates TLS itself (needs PKCS#12 cert)                  | Partial — cert plumbing declarative; listener enablement via first-boot/API |
| DoQ       | 853 udp    | Technitium terminates TLS itself (needs PKCS#12 cert; `libmsquic` dep) | Partial — same as DoT                                                       |

`DNS_SERVER_OPTIONAL_PROTOCOL_DNS_OVER_HTTP=true` enables plaintext DoH on TCP 80 **specifically to sit behind a TLS-terminating reverse proxy** — exactly our Caddy case. DoT/DoQ are NOT exposed as env vars; they are enabled in Technitium settings and require Technitium's own TLS certificate as a PKCS#12 bundle.

### 2.3 Metrics require authentication

Technitium exposes a native Prometheus endpoint (confirmed in [APIDOCS.md](https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md)):

- `GET /api/dashboard/metrics/text` → `Content-Type: text/plain; version=0.0.4`
- Requires `Dashboard: View` permission via `Authorization: Bearer <token>`
- The token is obtained via the **expiring** `POST /api/user/login` flow (NOT the non-expiring
  `createToken`), refreshed by a systemd timer — see §6 for the full model.

Marked experimental by upstream ("This API call is experimental and may change in later releases") — acceptable risk.

### 2.4 OIDC/SSO

`DNS_SERVER_SSO_*` env vars bootstrap OIDC on first boot:
`DNS_SERVER_SSO_ENABLED`, `DNS_SERVER_SSO_AUTHORITY`, `DNS_SERVER_SSO_CLIENT_ID`,
`DNS_SERVER_SSO_CLIENT_SECRET_FILE`, `DNS_SERVER_SSO_SCOPES`,
`DNS_SERVER_SSO_ALLOW_SIGNUP_ONLY_FOR_MAPPED_USERS`, `DNS_SERVER_SSO_GROUP_MAP`.

The OIDC **client** must be registered in Kanidm **on augustus** (that's the Kanidm host where `services.kanidm.provision.systems.oauth2` works). aedilis only consumes the issuer URL + client secret.

### 2.5 `DynamicUser` override

The upstream `services.technitium-dns-server` runs with `DynamicUser = true`. To grant read access to sops secret files and ACME certs via group ownership (the pattern loki/alloy use), we override to a static `technitium` user/group. This is required for secret + cert file access.

---

## 3. Let's Encrypt / Public Certificates in Nix

The repo currently uses **only** the internal step-ca for ACME (`nixos.acme` sets `defaults.server` to the step-ca directory). Public certs are new here but fully supported by `security.acme`.

### No Let's Encrypt account setup required

ACME account registration is automatic — `lego` (used by `security.acme`) creates and stores the
account key on first run, keyed to the cert's `email`. The repo already sets `acceptTerms = true`.
Nothing to pre-create manually.

**Email: `rae@plato-splunk.media`.** The shared `nixos.acme` module sets `defaults.email =
c.acme.email` (currently `web@jacob-alford.dev`) globally for _all_ hosts. To avoid changing every
host's ACME account, set the email **per-cert** for aedilis:

```nix
security.acme.certs."dns.plato-splunk.media".email = "rae@plato-splunk.media";
```

(Alternatively, migrate the global `constants.acme.email` to `rae@plato-splunk.media` if you want
all future certs under that address — a broader change affecting existing hosts' ACME accounts.
Per-cert override is the default here.)

### Chosen approach: HTTP-01

The `plato-splunk.media` zone is in AWS Route53, so DNS-01 is technically possible, but it requires
provisioning scoped IAM credentials and storing long-lived AWS keys on a public-facing DNS box.
**Decision: use HTTP-01 instead** — the tradeoff of exposing port 80 for ACME challenges is
preferred over managing AWS policies and hard-coded credentials on this host.

- Public cert for `dns.plato-splunk.media` via Let's Encrypt production directory.
- Override `server` per-cert back to Let's Encrypt (the module default points at step-ca).
- Port 80 must be publicly reachable (the VPS has a public IP — OK). The HTTP-01 challenge is
  served either by the `security.acme` built-in listener (`listenHTTP`) or proxied through Caddy's
  port-80 vhost (the pattern kanidm/prometheus already use for step-ca http-01).

```nix
security.acme.certs."dns.plato-splunk.media" = {
  server = "https://acme-v02.api.letsencrypt.org/directory"; # override step-ca default
  # HTTP-01: challenge served on port 80 (public IP). Either set listenHTTP here,
  # or route "http://dns.plato-splunk.media" through Caddy to the acme listener.
  group = "technitium";
  reloadServices = [ "caddy.service" "technitium-dns-server.service" ];
};
```

The resulting PEM is consumed by:

- **Caddy** for the public DoH vhost (`dns.plato-splunk.media:443`) — referenced explicitly via `tls <cert> <key>`.
- **Technitium** for DoT/DoQ, after conversion to PKCS#12 (see §4 provisioning).

**Firewall implication:** port 80/tcp must be open publicly for the ACME http-01 challenge
(already listed in §4.2 `security.nix`). Caddy's port-80 vhost should only serve the ACME
challenge path and otherwise redirect/deny.

### Alternative: DNS-01 via Route53 (rejected)

Natively supported (`dnsProvider = "route53"` + `environmentFile`) and needs no public port, but
requires scoped AWS IAM credentials stored in sops on the box. **Rejected** per decision above to
avoid AWS policy management and long-lived credentials on a public host.

### Mixing internal-CA and public certs in one Caddy

Modest complexity. `nixos.caddy`'s `useInternalCA` only flips Caddy's **global default** issuer to
step-ca. Every vhost in this repo already sets `tls`/`client_auth` **explicitly per-vhost** (see
kanidm, prometheus, loki). So:

- Public DoH vhost → `tls <letsencrypt-cert> <letsencrypt-key>` (from the HTTP-01 ACME cert).
- Internal admin/metrics vhosts → `tls <step-ca-cert> <step-ca-key>` + `client_auth` mTLS block.

Because each vhost names its cert explicitly, Caddy's global default issuer is irrelevant for these
vhosts and there is no conflict. `security.acme` manages **both** cert types (Let's Encrypt for
public, step-ca for internal); Caddy only references the files on disk. We do **not** rely on
Caddy's own ACME, keeping issuance uniform.

---

## 4. Files to CREATE

### 4.1 Technitium feature module — `nix-config/modules/features/technitium/`

Follows the multi-file feature pattern from `features/cicero-observability/`.

- **`complete.nix`** — `flake.modules.nixos.technitium` aggregating sub-modules via `imports`.
- **`service.nix`** — wrapper around upstream `services.technitium-dns-server`:
  - Enables upstream service, `openFirewall = false` (firewall controlled explicitly).
  - Overrides `DynamicUser` → static `technitium` user/group.
  - Sets first-boot `environment` / `EnvironmentFile` with `DNS_SERVER_*` bootstrap vars:
    - `DNS_SERVER_DOMAIN=dns.plato-splunk.media`
    - `DNS_SERVER_WEB_SERVICE_LOCAL_ADDRESSES=127.0.0.1`
    - `DNS_SERVER_WEB_SERVICE_HTTP_PORT=5380`
    - `DNS_SERVER_OPTIONAL_PROTOCOL_DNS_OVER_HTTP=true` (DoH behind Caddy)
    - `DNS_SERVER_WEB_SERVICE_REVERSE_PROXY_ADDRESSES=127.0.0.1`
    - `DNS_SERVER_ADMIN_PASSWORD_FILE=<sops path>`
    - Recursion (open resolver; abuse mitigation via rate limiting + firewall — see §7a):
      - `DNS_SERVER_RECURSION=Allow` (recursion open to any client)
      - (no `DNS_SERVER_RECURSION_NETWORK_ACL` — gating is at the transport/firewall layer)
    - Forwarders: `DNS_SERVER_FORWARDERS=...` + `DNS_SERVER_FORWARDER_PROTOCOL=Https|Tls|Quic`
    - SSO: `DNS_SERVER_SSO_ENABLED=true`, `DNS_SERVER_SSO_AUTHORITY=https://idm.plato-splunk.media/oauth2/openid/technitium`, `DNS_SERVER_SSO_CLIENT_ID=technitium`, `DNS_SERVER_SSO_CLIENT_SECRET_FILE=<sops path>`, `DNS_SERVER_SSO_SCOPES=openid,profile,email`, `DNS_SERVER_SSO_ALLOW_SIGNUP_ONLY_FOR_MAPPED_USERS=true`, `DNS_SERVER_SSO_GROUP_MAP=Administrators:Administrators`
  - Exposes module options (`domain`, `forwarders`, `oidc.*`, `recursion.*`) so host config stays declarative.
- **`caddy.nix`** — imports `nixos.caddy`; defines vhosts:
  - `https://dns.plato-splunk.media` (public, Let's Encrypt) → `reverse_proxy 127.0.0.1:80` (Technitium DoH).
  - `https://dns-admin.plato-splunk.media` (Tailscale, mTLS `client_auth require_and_verify` against internal root CA) → `reverse_proxy 127.0.0.1:5380`.
  - `https://dns-metrics.plato-splunk.media:<port>` (mTLS) → `reverse_proxy 127.0.0.1:5380`, path-restricted to `/api/dashboard/metrics/text`.
  - `http://dns.plato-splunk.media` on :80 → serves the **Let's Encrypt HTTP-01** challenge (public ACME); otherwise redirect to HTTPS.
  - `http://dns-admin...`, `http://dns-metrics...` on :80 → serve **step-ca** http-01 challenges (internal certs).
- **`acme.nix`** — `security.acme` with:
  - Public cert `dns.plato-splunk.media` → Let's Encrypt via **HTTP-01** (`server` overridden to the LE production directory; challenge on port 80), group `technitium`, reloads caddy + technitium.
  - Public cert `dns.plato-splunk.media` → Let's Encrypt via **HTTP-01**; `email` overridden
    **per-cert** to `rae@plato-splunk.media` (see §3), group `technitium`, reloads caddy + technitium.
  - Internal step-ca client cert `dns-metrics.plato-splunk.media` (mirrors `cicero-observability-acme`) for Alloy→Loki push + Caddy mTLS server cert.
  - `users.groups.technitium = { }`.
- **`provision.nix`** — oneshot `technitium-provision.service` (ordered after first service start). Idempotent. Responsibilities:
  1. Log in via API using the admin password (sops).
  2. Ensure a limited `prometheus` user exists (password from sops, `Dashboard: View` only). Set a
     generous `sessionTimeoutSeconds` on that user via `profile/set`. **Enable TOTP** on the user
     (one-time bootstrap using the sops-stored TOTP seed; see §6).
  3. Convert the Let's Encrypt PEM for `dns.plato-splunk.media` → PKCS#12 (`openssl pkcs12 -export`) with a sops-provided password; point Technitium's DoT/DoQ TLS cert path + enable the optional protocols via API.
  - Re-runs on cert renewal (via `reloadServices`/`restartTriggers`).
  - **Note:** aedilis no longer mints a long-lived API token. Token acquisition is done on augustus
    via short-lived login sessions (§6).
- **`alloy.nix`** — mirrors `cicero-observability-alloy`: ship journald → augustus Loki push via mTLS using the `dns-metrics` client cert. Static `alloy` user, `cicero-observability`-style group for cert access.
- **`node-exporter.nix`** — node_exporter on `127.0.0.1:9100` (host metrics), scraped via the mTLS Caddy endpoint (mirrors `cicero-observability-node-exporter`).

### 4.2 Host private config — `nix-config/modules/_private/aedilis/`

- **`hardware.nix`** — from the OVH base image:
  ```nix
  { modulesPath, lib, ... }:
  {
    imports = [ (modulesPath + "/profiles/qemu-guest.nix") ];
    boot.loader.grub.device = "/dev/sda";
    boot.initrd.availableKernelModules = [ "ata_piix" "uhci_hcd" "xen_blkfront" "vmw_pvscsi" ];
    boot.initrd.kernelModules = [ "nvme" ];
    fileSystems."/" = { device = "/dev/sda1"; fsType = "ext4"; };
    nixpkgs.hostPlatform = lib.mkDefault "x86_64-linux";
  }
  ```
- **`system.nix`** — from the OVH `configuration.nix` + repo conventions:
  - `services.logrotate.checkConfig = false;` (OVH/nix#8502 workaround)
  - `boot.tmp.cleanOnBoot = true;`, `zramSwap.enable = true;`
  - `networking.domain = "vps.ovh.us";`
  - timezone `America/Denver`, locale `en_US.UTF-8`
  - `services.tailscale.enable = true;`
  - `systemd.services.tailscaled.environment.TS_PERMIT_CERT_UID = "caddy";` (praeconinus pattern)
  - `nixpkgs.config.allowUnfree = true;`
  - `system.stateVersion = "23.11";` (match the installed base image to avoid state migration)
- **`security.nix`** — firewall:
  - Public `allowedTCPPorts`: 443, 853, 80 (public ACME http-01) — **no public 53**
  - Public `allowedUDPPorts`: 853 (DoQ) — **no public 53**
  - `tailscale0` interface only: 22 (SSH), 53 (plain DNS for personal devices, tcp+udp),
    dns-admin/dns-metrics ports, 5252 (TS metrics)
  - `security.pki.certificateFiles = [ (inputs.self + "/certs/alford-root.crt") ];`
  - Optional `services.ssh-cert-renewer` (gated on step-ca reachability).
- **`users.nix`** — `jacob` + `rae`, `wheel`, YubiKey SSH keys (from base image + existing hosts).
- **`sops.nix`** — `defaultSopsFile = secrets/aedilis.yaml`; secrets:
  - `technitium_admin_password`
  - `technitium_sso_client_secret`
  - `technitium_pkcs12_password`
  - `technitium_metrics_user_password` (limited `prometheus` user password — see §6)
  - `technitium_metrics_totp_secret` (base32 TOTP seed for the `prometheus` user — see §6)
  - `ssh-cert-renewer` password (if used)
- **`programs.nix`** — `git`, `zsh`, `openssl`, maybe `step-cli`.

### 4.3 Host entry point — `nix-config/modules/hosts/aedilis.nix`

```nix
flake.nixosConfigurations.aedilis = inputs.nixpkgs.lib.nixosSystem {
  system = "x86_64-linux";
  specialArgs = { inherit inputs; pkgs-unstable = ...; };
  modules = [
    inputs.home-manager.nixosModules.home-manager
    inputs.nixvim.nixosModules.nixvim
    inputs.sops-nix.nixosModules.sops

    nixos.system-base
    nixos.caddy
    nixos.acme
    nixos.technitium

    ./../_private/aedilis/hardware.nix
    ./../_private/aedilis/security.nix
    ./../_private/aedilis/users.nix
    ./../_private/aedilis/sops.nix
    ./../_private/aedilis/system.nix
    ./../_private/aedilis/programs.nix

    { networking.hostName = "aedilis"; }
  ];
};
```

### 4.4 Secrets — `nix-config/secrets/aedilis.yaml`

**Requires your action** — needs your age/YubiKey recipients to encrypt. The plan will provide the exact `sops` command and `.sops.yaml` creation rule. Secrets listed in §4.2 `sops.nix`.

---

## 5. Files to MODIFY

- **`nix-config/modules/constants.nix`** — add `aedilis = { system = "x86_64-linux"; };` to `constants.hosts`.
- **`nix-config/modules/service-registry.nix`** — add a `technitium` block under `constants.services`:
  - subdomains/domains for `dns`, `dns-admin`, `dns-metrics`
  - ports: DNS 53, web 5380, DoT/DoQ 853, DoH 443, metrics port + `acmePort`
  - mirror a `dns-metrics`/`aedilis-metrics` entry on the `cicero-metrics` model.
- **`nix-config/modules/services/kanidm.nix`** (augustus) — add groups `technitium.admins`, `technitium.access`; add them to `jacob`/`rae` persons.
- **OIDC client registration** (augustus) — new module or in `kanidm.nix`:
  ```nix
  services.kanidm.provision.systems.oauth2."technitium" = {
    originUrl = "https://dns-admin.plato-splunk.media/api/user/sso/oauth2/callback"; # confirm exact callback path
    originLanding = "https://dns-admin.plato-splunk.media/";
    displayName = "Technitium DNS";
    basicSecretFile = config.sops.secrets.technitium_client_secret.path;
    scopeMaps."technitium.access" = [ "openid" "profile" "email" ];
    claimMaps.groups = { # or group map consumed by DNS_SERVER_SSO_GROUP_MAP
      joinType = "array";
      valuesByGroup."technitium.admins" = [ "Administrators" ];
    };
  };
  ```
  Add sops secret `technitium_client_secret` on **augustus**.
- **`nix-config/modules/services/prometheus.nix`** (augustus) — add an `aedilis` scrape job + a token-exchange oneshot:
  ```nix
  {
    job_name = "aedilis";
    scheme = "https";
    metrics_path = "/api/dashboard/metrics/text";
    authorization.credentials_file = "/run/technitium-metrics/token"; # from oneshot (§6)
    tls_config = {
      ca_file = toString c.ca.rootCert;
      cert_file = "${promClientCertDir}/fullchain.pem";
      key_file  = "${promClientCertDir}/key.pem";
      server_name = c.services.dns-metrics.domain;
    };
    static_configs = [{ targets = [ "dns-metrics.plato-splunk.media:<port>" ]; labels.instance = "aedilis"; }];
  }
  ```
  - Reuses the existing `prometheus-client` mTLS cert.
  - Add `technitium-metrics-token.service` oneshot + `technitium-metrics-token.timer` (§6): logs in
    with the sops password + computed TOTP, writes the expiring bearer token to
    `/run/technitium-metrics/token`; timer refreshes before expiry. Order prometheus
    `after`/`wants` the service; add `oathtool` (`pkgs.oath-toolkit`) to its PATH.
  - Add `technitium_metrics_user_password` and `technitium_metrics_totp_secret` to **augustus** sops.
  - Add `/run/technitium-metrics` via `systemd.tmpfiles` owned by the prometheus user.
  - Add `aedilis` to the `tailscale` scrape job targets.
- **`flake.nix`** — add devshell command:
  ```
  remote-build-aedilis → nixos-rebuild --target-host jacob@aedilis.neko-bicolor.ts.net switch --flake .#aedilis --sudo --ask-sudo-password
  ```
- **`docs/port-assignments.md`** — add an **Aedilis** section (22, 53, 80, 443, 853, 5252, 5380, 9100, metrics port); bump "Last updated".
- **`.sops.yaml`** (repo root, if present) — add a creation rule for `nix-config/secrets/aedilis.yaml` keyed to your age recipients.

---

## 6. Metrics Authentication — expiring login token + TOTP, refreshed on a timer

Technitium's metrics endpoint (`/api/dashboard/metrics/text`) requires `Authorization: Bearer
<token>` with `Dashboard: View` permission. **Chosen model: use the `login` endpoint (which issues
an EXPIRING session token), not `createToken` (non-expiring).** A systemd timer refreshes the token
before it expires. This bounds the usefulness of any exfiltrated token to the session timeout
window.

### Why `login` over `createToken`

`createToken` mints a **non-expiring** API token — undesirable (a leaked token is valid forever).
`login` returns a session token that expires after the user's `sessionTimeoutSeconds` of
inactivity (default 30 min, sliding window reset on each API call). Since Prometheus scrapes every
15s, continuous scraping keeps the session alive; a stolen token still dies once scraping stops
longer than the timeout.

### Credentials in sops (both minimal)

- `technitium_metrics_user_password` — password for the limited `prometheus` user.
- `technitium_metrics_totp_secret` — base32 TOTP seed for that user (defense-in-depth; see below).

Stored on **augustus** (which performs the login) and referenced on **aedilis** only for the
one-time user/TOTP bootstrap in `provision.nix`.

### Token exchange flow (oneshot + timer on augustus)

1. `technitium-metrics-token.service` (oneshot) runs the login:
   - Compute the current TOTP: `TOTP=$(oathtool --totp -b "$TOTP_SECRET")`.
   - `POST https://dns-metrics.plato-splunk.media/api/user/login?user=prometheus&pass=$PASS&totp=$TOTP`
     over the mTLS Tailscale endpoint (client cert = existing `prometheus-client` cert).
   - Parse JSON `token`; write to `/run/technitium-metrics/token` (0640, owned by `prometheus`).
2. `technitium-metrics-token.timer` fires the oneshot on a cadence **comfortably shorter than**
   `sessionTimeoutSeconds` (e.g. refresh every 10 min if timeout is 30 min; or set a longer user
   timeout and refresh hourly). Each run acquires a **fresh** token, so even if scraping stalled,
   the next scrape has a valid token.
3. Prometheus reads the token via `authorization.credentials_file = "/run/technitium-metrics/token"`.
   Prometheus re-reads the credentials file per scrape, so a refreshed token is picked up without a
   Prometheus reload.

### TOTP (optional hardening — included)

The `login` endpoint accepts a `totp` parameter directly. We enable 2FA on the `prometheus` user and
store the shared seed in sops. An attacker then needs **both** the password and the TOTP seed to
mint new tokens.

- Marginal gain: both secrets live in the same sops file, so compromising sops yields both. The real
  value is defense-in-depth against password-only leaks (logs, env inspection, a misconfigured
  secret).
- **Bootstrap wrinkle (chicken-and-egg):** TOTP must be enabled on the user before login requires it.
  The seed must be known to both the Technitium user config and the sops secret. Flow:
  1. One-time: generate a TOTP seed (or run `2fa/init` which returns a seed), store it in sops.
  2. `provision.nix` on aedilis calls `2fa/init` + `2fa/enable` for the `prometheus` user using that
     seed. (If Technitium only accepts a server-generated seed from `2fa/init`, capture that seed
     during first provisioning and write it into sops — a one-time manual step.)
- `oathtool` (from `pkgs.oath-toolkit`) added to the augustus oneshot's PATH to compute codes.

### Session timeout tuning

Set the `prometheus` user's `sessionTimeoutSeconds` via `profile/set` during provisioning to a value
that balances security (shorter = smaller exfiltration window) against resilience (longer = survives
scrape gaps). Suggested: 1 hour timeout, refresh timer every 20–30 min.

> **To verify during implementation:**
>
> - `login` + `totp` parameter behavior and whether re-login invalidates the prior session or
>   coexists (affects whether we should `logout` old sessions each refresh).
> - Whether `2fa/init` requires a server-generated seed (vs. accepting our own), determining if the
>   TOTP seed bootstrap needs a one-time manual capture step.
> - Token file permissions vs. the Prometheus service user on augustus; `/run/technitium-metrics`
>   tmpfiles ownership.
> - That the limited `prometheus` user can be created with **only** `Dashboard: View` so a leaked
>   token can't modify DNS config.

---

## 7. Open Decisions / Items to Confirm During Implementation

1. **Public cert challenge — RESOLVED: HTTP-01.** Route53 DNS-01 rejected to avoid long-lived AWS
   credentials on a public host. Port 80 is opened publicly for the ACME challenge.
2. **Exact Technitium OIDC callback URL** — confirm the precise redirect path Technitium expects for
   `originUrl` in the Kanidm client.
3. **Metrics token model — RESOLVED: expiring `login` token + TOTP, refreshed by a systemd timer**
   (§6). Verify `login`/`totp` and `2fa/init` seed behavior during implementation.
4. **DoT/DoQ listener enablement via API** — confirm the exact API calls to enable optional protocols
   and set the PKCS#12 cert, for the provisioning oneshot.
5. **Recursion policy — RESOLVED: amplification-hardened (see §7a).**
6. **Failure notifications** — left out (consistent with cicero/praeconinus). Can attach later.

---

## 7a. DNS Amplification Mitigation (recursion policy) — UPDATED 2026-10-13

Goal: run aedilis as a personal **recursive resolver** that any client may use, without letting it
be abused as an open resolver for amplification/reflection DoS. Because public plaintext UDP/53 is
the amplification vector, the design removes it from the public internet entirely and relies on
connection-oriented encrypted transports + rate limiting for public recursion.

1. **Recursion is open (`DNS_SERVER_RECURSION=Allow`).** Any client may get recursive answers. There
   is no network ACL gating recursion anymore — the gating is done at the transport/firewall layer
   instead (below).

2. **No public plaintext UDP/53.** Port 53 (udp+tcp) is **closed at the public firewall** and
   allowed only on the `tailscale0` interface. The public internet therefore cannot reach the
   source-spoofable UDP/53 listener at all, which eliminates the classic amplification/reflection
   vector regardless of the recursion setting. (Technitium cannot disable its plain-53 listener
   selectively — DoH/DoT/DoQ bind to the same interface addresses on different ports, confirmed in
   the vendored `DnsServer.cs` — so the firewall is the correct and only tool here.)

3. **Public recursion only over encrypted transports.** DoH (443), DoT (853/tcp), and DoQ (853/udp
   QUIC) are TCP/QUIC — connection-oriented and not blindly source-spoofable like UDP/53 — so they
   can safely carry open recursion for the public internet without enabling reflection.

4. **Per-client rate limiting (QPS/QPM cap).** Technitium's built-in request rate limiting caps
   per-client queries (configured via the provisioner / `settings/set`). With recursion open this is
   the **primary** abuse control, bounding DoS and residual amplification. Over-limit UDP gets TC=1
   (TCP retry) rather than being dropped.

5. **DNSSEC validation on.** Recursive answers are DNSSEC-validated, protecting clients from forged
   or poisoned upstream responses.

**Net design:** public recursion is available only over encrypted, non-spoofable transports and is
rate-limited; plaintext 53 is firewalled off the public internet and reachable only over Tailscale
for personal devices. This preserves open-resolver convenience for your own use while removing the
amplification surface.

---

## 7b. Do we even need public plain 53/udp? (role & HA)

If recursion is locked down (§7a), the question is whether to expose plain 53 publicly at all. The
answer depends entirely on aedilis's **role**:

### If aedilis is an authoritative nameserver (now or planned)

**Yes — public 53/udp + 53/tcp are required.** The DNS protocol mandates that authoritative
servers answer on plain UDP/53 (with TCP/53 fallback for large responses and zone transfers).
Recursive resolvers across the internet query authoritative servers over **plain** 53 — they do
**not** use DoH/DoT/DoQ to reach authoritative servers. You cannot serve public authoritative DNS
over encrypted transports alone. In this role, public 53 is authoritative-only (no recursion),
exactly the §7a design.

**This is what enables a future high-availability authoritative setup.** The standard HA pattern is
multiple authoritative nameservers listed as `NS` records for a zone (primary + secondaries), kept
in sync via zone transfers (AXFR/IXFR) or Technitium clustering/catalog zones. For aedilis to be
one of several authoritative servers for a zone — so DNS keeps resolving if one host dies — it must
answer on public 53. Keeping public 53 open (authoritative-only) now means you can add secondaries
later **without reopening the firewall or changing the security posture.** Technitium supports
primary, secondary, and catalog zones for exactly this.

> Benefit summary: public authoritative 53 gives you (a) the ability to host your own zones' NS
> records on aedilis, and (b) a path to multi-server HA authoritative DNS (primary + secondaries
> with zone transfer) whenever you want it.

### If aedilis is purely a recursive resolver for your own devices

**No — drop public 53 entirely.** Restrict 53/udp + 53/tcp to the `tailscale0` interface (and any
trusted LAN) alongside the encrypted transports. This is the most locked-down posture: nothing on
plain 53 is reachable from the public internet, eliminating amplification surface completely.

### Decision for this plan — UPDATED 2026-10-13: recursive resolver

aedilis is a personal **recursive resolver**, NOT an authoritative nameserver. Public plaintext 53
is **dropped entirely** (firewalled off the public internet; reachable only over `tailscale0` for
personal devices). Public recursion is served only over the encrypted transports (DoH/DoT/DoQ) with
per-client rate limiting (§7a). This is the most locked-down posture: nothing on plain UDP/53 is
reachable from the public internet, eliminating the amplification surface.

Authoritative DNS and any future high-availability authoritative setup (primary + secondaries, zone
transfers) will be stood up on **separate VPS hosts** dedicated to that role, not on aedilis.

> Previous decision (superseded): aedilis was planned as an authoritative nameserver keeping public
> 53 open (authoritative-only) for HA readiness. That intent moved to dedicated hosts; aedilis is now
> purely a recursive resolver.

- `dprint fmt fmt .` on all new `.nix` files.
- `nix build .#nixosConfigurations.aedilis.config.system.build.toplevel` — evaluate aedilis.
- `nix build .#nixosConfigurations.augustus.config.system.build.toplevel` — confirm Kanidm/Prometheus changes still evaluate.
- Deploy via `remote-build-aedilis` once the age key + secrets are present on the box.

---

## 9. Checklist

- [ ] `features/technitium/{complete,service,caddy,acme,provision,alloy,node-exporter}.nix`
- [ ] `_private/aedilis/{hardware,system,security,users,sops,programs}.nix`
- [ ] `hosts/aedilis.nix`
- [ ] `secrets/aedilis.yaml` (your action — encryption)
- [ ] `constants.nix` host entry
- [ ] `service-registry.nix` technitium + dns-metrics entries
- [ ] augustus `kanidm.nix` groups + OIDC client registration + sops secret
- [ ] augustus `prometheus.nix` scrape job (mTLS + bearer) + `technitium-metrics-token` oneshot + metrics-user password in augustus sops
- [ ] `flake.nix` `remote-build-aedilis` command
- [ ] `docs/port-assignments.md` Aedilis section
- [ ] `.sops.yaml` creation rule
- [ ] evaluates clean on both aedilis and augustus
