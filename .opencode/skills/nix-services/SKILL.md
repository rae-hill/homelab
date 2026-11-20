---
name: nix-services
description: NixOS systemd service patterns in nix-config: failure-notifs Pushover notifications, attachServices placement rules, message priority, and podman container-to-service naming. Use when creating or modifying systemd services, OCI containers, or failure notifications in nix-config.
---

# Nix Services & Systemd Patterns

## Failure Notifications

Systemd service failures on **augustus** are reported **directly to Pushover**. Only augustus has failure notifications at present.

### How It Works

1. The `failure-notifs` module (`nix-config/modules/homelab/homelab-failure-notifs.nix`) defines a oneshot systemd service triggered by `OnFailure=`
2. When a monitored service fails, systemd invokes `failure-notifs.service` with `MONITOR_UNIT`, `MONITOR_SERVICE_RESULT`, and `MONITOR_EXIT_STATUS` environment variables (metadata is only propagated when a single unit triggers the handler)
3. The service `POST`s directly to the Pushover Messages API (`https://api.pushover.net/1/messages.json`) with `token` + `user` + `message` (mirroring how Grafana talks to Pushover). There is no intermediary — the former Apprise container was removed because it was unreliable.

The Pushover credentials are encrypted in `nix-config/system-configs/augustus/secrets/failure-notifs.yaml`, but DELIVERY is SecretSpec (the Phase 3b pilot of `docs/secretspec-migration-plan.md`): the unit's ExecStart is an exec wrapper (`constants.secretspec.mkWrapper` from `nix-config/lib/secretspec.nix`) running `secretspec run --profile augustus --scope failure-notifs-augustus`; both secrets are declared `as_path = true` in `system-configs/augustus/secretspec.toml`, so the wrapper's glue exports `PUSHOVER_USER_KEY_FILE`/`PUSHOVER_TOKEN_FILE` pointing at 0400 temp files that die with the process. There are no `sops.secrets.pushover_*` declarations and no `/run/secrets` files for this service. The `pushover_token` VALUE is still shared with Grafana's Pushover app token (separate secret declarations).

### Attaching Services to Failure Notifications

To monitor a new systemd service for failures, add this to the relevant Nix module:

```nix
services.failure-notifs.attachServices = [
  "my-service-name"
];
```

NixOS merges list options by concatenation, so multiple modules can each contribute to `attachServices` independently.

### Where to Place `attachServices`

- **Augustus-only modules** (kanidm, postgres, habitsync, planka, home-assistant, minecraft, openwebui, radius, it-tools): Place directly in the service module file.
- **Shared modules** (caddy, homelab-api, homelab-secret-provisioner) or host-level services (tailscaled): Place in the host's system config (`nix-config/system-configs/augustus/system.nix`), since other hosts loading the same module don't have the `failure-notifs` option available.

### Current Attached Services

Augustus-only modules contribute:

- `kanidm`, `restic-backups-kanidm`, `kanidm-posix-provision`
- `postgresql`, `postgresql-provision-passwords`, `postgresql-update-certs`, `restic-backups-postgres`
- `podman-habitsync`, `restic-backups-habitsync`
- `podman-planka`, `restic-backups-planka`
- `home-assistant`
- `minecraft-server-vanilla`, `restic-backups-minecraft`
- `open-webui`, `restic-backups-openwebui`
- `podman-radiusd`
- `podman-it-tools`

Private augustus config contributes:

- `caddy`
- `homelab-api`
- `homelab-secret-provisioner`
- `tailscaled`

### Message Priority

`services.failure-notifs.priority` sets the Pushover priority (-2..2; default `1` = high, bypasses quiet hours). Use `2` for emergency (requires acknowledgement). `titlePrefix` and `emoji` customise the notification title. There is no longer a tag/group indirection layer — severity is a direct Pushover priority.

> Future need: a general-purpose way for _applications_ (not just systemd units) to submit notifications. Apprise previously filled this role but was unreliable and has been removed; a replacement is TBD.

NixOS `virtualisation.oci-containers.containers.<name>` creates a systemd service named `podman-<name>.service`. Use this name when referencing containers in `attachServices` or systemd dependency declarations.

| Container definition   | Systemd service name |
| ---------------------- | -------------------- |
| `containers.planka`    | `podman-planka`      |
| `containers.habitsync` | `podman-habitsync`   |
| `containers.it-tools`  | `podman-it-tools`    |
| `containers.radiusd`   | `podman-radiusd`     |
