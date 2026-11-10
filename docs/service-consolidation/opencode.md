# opencode — New catalog-native service (nixos workstation)

Status: **IMPLEMENTED**
Date: 2026-10-31
Index: [./README.md](./README.md)

> Unlike the other documents in this directory, this is **not a migration plan** — opencode is a
> new service born directly on the catalog + generators, and the nixos workstation becomes an
> apphost (`homelab-service-apphost`) for the first time. There is no prior emitted output, so
> there is no parity gate; the `nix eval` spot checks in §3 are the verification surface.

---

## 1. What it is

The opencode web UI, reachable from any device on the tailnet at
**https://opencode.plato-splunk.media**, fronted by Caddy on the nixos workstation:

- **Backend:** the home-manager `programs.opencode.web` user service (jacob@nixos) runs
  `opencode serve --hostname 127.0.0.1 --port 49375 --service` — LOOPBACK only, never exposed
  directly. `--service` makes it the **managed background service**: it registers itself in
  `~/.local/state/opencode/service.json`, so a bare `opencode` CLI on the workstation auto-attaches
  to the same server (TUI and web UI share sessions), and `opencode service status` / `opencode api`
  resolve to it. The port is `constants.services.opencode.port` (deliberately **not** opencode's
  49374 channel default) and is mirrored into `~/.config/opencode/service.json` (`opencode service
  set port 49375` + `set hostname 127.0.0.1`), so a CLI-side start attempt targets the same address
  and finds this incumbent instead of racing it. Lifecycle is owned by systemd (`systemctl --user
  restart opencode-web`), not `opencode service start/stop` (Restart=always resurrects; a
  CLI-spawned replacement would collide on the port). `linger` is enabled for jacob so the user
  service survives reboots without a graphical login.
- **Server cert:** Caddy-managed via the internal step-ca (`services.caddy.useInternalCA` in
  `features/opencode/caddy-host.nix`; `tls.cert.shared` in the catalog). The HTTP-01 challenge
  arrives over the tailnet on :80 — opened by hand on tailscale0 in `_private/nixos/security.nix`
  (mirrors cicero; the generator only opens `listenPort` + direct-challenge acmePorts).
- **Access gate:** mutual TLS (`tls.gate.mtls`, trust pool = `certs/alford-root.crt`,
  cert-less `tls { client_auth … }` form — same as loki-push / cicero-metrics). Only devices
  holding a step-ca client cert get through. The opencode Basic-auth password (username is always
  `opencode`) is a deliberate throwaway behind the mTLS gate. In `--service` mode `OPENCODE_PASSWORD`
  is **ignored**: the password lives in `~/.config/opencode/service.json` (set once via
  `opencode service set password hackme`) and is carried in the registration file so discovered CLI
  clients authenticate automatically.
- **Firewall:** `access.scope.tailnet` → the generator opens :443 on **tailscale0 only** — the
  vhost is not reachable from the LAN or the internet.
- **DNS:** `opencode` A/AAAA → the nixos tailnet address, folded on aedilis from
  `flake.catalogDns` (`service-registry.nix`); the catalog entry's `dns.tailnet` /
  `managedBy.dns` are declared intent.

## 2. Files

| Concern                   | Where                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| Catalog entry             | `nix-config/modules/features/opencode/catalog.nix`                                               |
| Host-level Caddy settings | `nix-config/modules/features/opencode/caddy-host.nix`                                            |
| Feature aggregate         | `nix-config/modules/features/opencode/complete.nix` (`nixos.opencode`)                           |
| Host imports              | `nix-config/modules/hosts/nixos.nix` (`homelab-service-apphost` + `opencode`)                    |
| Port + DNS facts          | `nix-config/modules/service-registry.nix` (`constants.services.opencode`, `catalogDns.opencode`) |
| :80 challenge opening     | `nix-config/modules/_private/nixos/security.nix` (tailscale0 only)                               |
| Web user service          | `nix-config/modules/home/jacob-nixos.nix` (`programs.opencode.web`)                              |
| Linger                    | `nix-config/modules/_private/nixos/users.nix`                                                    |

## 3. Spot checks

```sh
# vhost renders (cert-less mTLS tls block + reverse_proxy 127.0.0.1:49375):
nix eval --raw '.#nixosConfigurations.nixos.config.services.caddy.virtualHosts."https://opencode.plato-splunk.media".extraConfig'

# :443 tailscale0-only (generator) and :80 tailscale0-only (hand-listed); NOT in the
# public allowedTCPPorts:
nix eval --json .#nixosConfigurations.nixos.config.networking.firewall.interfaces.tailscale0.allowedTCPPorts
nix eval --json .#nixosConfigurations.nixos.config.networking.firewall.allowedTCPPorts

# DNS record folded into the aedilis zone:
nix eval --json .#nixosConfigurations.aedilis.config.services.technitium-server-complete.provision.ensureDnsRecords.zones \
  | jq '.["plato-splunk.media"].records[] | select((.A.name // .AAAA.name) == "opencode.plato-splunk.media")'

# The user service unit (ExecStart carries --hostname 127.0.0.1 --port 49375 --service):
nix eval --raw '.#homeConfigurations."jacob@nixos".config.systemd.user.services.opencode-web.Unit' 2>/dev/null || \
  nix eval --json '.#homeConfigurations."jacob@nixos".config.systemd.user.services.opencode-web'
```

## 4. Operational notes

- **Deployment order:** aedilis must pick up the DNS record (deploy aedilis) before the step-ca
  HTTP-01 challenge can resolve `opencode.plato-splunk.media` → the nixos tailnet address; caddy
  on nixos retries issuance automatically.
- **Device access:** browsers/devices need the step-ca client cert (the `eap` device-attest
  provisioner) plus the alford root in their trust store — the same prerequisites as the existing
  mTLS surfaces (postgres, loki-push).
- **Web UI login:** username `opencode`, password from `~/.config/opencode/service.json`
  (`opencode service get password`; set to the `hackme` throwaway). `OPENCODE_PASSWORD` does not
  apply in `--service` mode.
- **Managed-service registration:** `~/.local/state/opencode/service.json` appears while the unit
  runs and is removed on graceful stop; if it is ever stale, `serve --service` retries the bind for
  15s before failing. If the CLI's auto-"replace" (version skew between the CLI binary and the
  running unit) fights the unit, rebuild so both come from the same package version.
