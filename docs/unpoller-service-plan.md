# Plan: Unpoller (UniFi Monitoring) on Augustus

## Overview

Deploy [Unpoller](https://github.com/unpoller/unpoller) as a native systemd service on Augustus using the NixOS `services.unpoller` module. Unpoller polls a UniFi controller and exports metrics via a Prometheus exporter endpoint and pushes events/logs to Loki. This provides full observability over UniFi network equipment (switches, APs, gateways) via the existing Prometheus + Loki + Grafana stack.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                           Augustus                                │
│                                                                    │
│  UniFi Controller (UDM/CloudKey) ◀──poll── Unpoller               │
│       (remote, e.g. 192.168.x.x)              │                   │
│                                                ├──▶ :9130 (metrics)│
│                                                │        │          │
│                                                │    Prometheus      │
│                                                │    (scrape)        │
│                                                │                    │
│                                                └──▶ Loki           │
│                                                     (push events)  │
│                                                                    │
│  Grafana ◀── queries ── Prometheus + Loki                         │
└──────────────────────────────────────────────────────────────────┘
```

**Data flow:**

1. Unpoller polls the UniFi controller API at a configurable interval (default 30s)
2. Metrics are exposed at `127.0.0.1:9130/metrics` for Prometheus to scrape
3. Events, alarms, anomalies, and IDS data are pushed directly to the local Loki instance
4. Grafana dashboards query both Prometheus and Loki for unified network visibility

## Service Details

| Property          | Value                                                   |
| ----------------- | ------------------------------------------------------- |
| Service name      | `unpoller`                                              |
| Systemd unit      | `unifi-poller.service`                                  |
| NixOS module      | `services.unpoller`                                     |
| Prometheus port   | `9130`                                                  |
| Prometheus bind   | `127.0.0.1:9130`                                        |
| User/Group        | `unifi-poller` / `unifi-poller` (created by the module) |
| Host              | Augustus                                                |
| Auth method       | None (localhost only, scraped by local Prometheus)      |
| Controller secret | SOPS-encrypted password in `secrets/augustus.yaml`      |

---

## NixOS Module Reference

The NixOS `services.unpoller` module (identical in 26.05 and unstable) is located at:

- `repos/nixpkgs-26.05/nixos/modules/services/monitoring/unpoller.nix`
- `repos/nixpkgs-unstable/nixos/modules/services/monitoring/unpoller.nix`

There is also a Prometheus exporter variant at:

- `repos/nixpkgs-26.05/nixos/modules/services/monitoring/prometheus/exporters/unpoller.nix`

We will use the **standalone `services.unpoller`** module (not the exporter variant) because:

- It supports Loki output (the exporter variant also supports it but the standalone gives full control)
- It allows configuring InfluxDB disable, Loki push, and Prometheus exporter all in one place
- The systemd unit is more configurable

### Key NixOS Options

| Option                                            | Type      | Default                    | Purpose                                 |
| ------------------------------------------------- | --------- | -------------------------- | --------------------------------------- |
| `services.unpoller.enable`                        | bool      | `false`                    | Enable the service                      |
| `services.unpoller.poller.debug`                  | bool      | `false`                    | Verbose logging                         |
| `services.unpoller.poller.quiet`                  | bool      | `false`                    | Suppress interval logs                  |
| `services.unpoller.prometheus.disable`            | bool      | `false`                    | Disable Prometheus exporter             |
| `services.unpoller.prometheus.http_listen`        | str       | `"[::]:9130"`              | Exporter bind address                   |
| `services.unpoller.influxdb.disable`              | bool      | `false`                    | Disable InfluxDB output                 |
| `services.unpoller.loki.url`                      | str       | `""`                       | Loki push URL                           |
| `services.unpoller.loki.interval`                 | str       | `"2m"`                     | Event poll interval for Loki            |
| `services.unpoller.loki.timeout`                  | str       | `"10s"`                    | Loki push timeout                       |
| `services.unpoller.unifi.defaults.url`            | str       | `"https://127.0.0.1:8443"` | UniFi controller URL                    |
| `services.unpoller.unifi.defaults.user`           | str       | `"unifi"`                  | Controller API username                 |
| `services.unpoller.unifi.defaults.pass`           | path      | (file path)                | File containing controller password     |
| `services.unpoller.unifi.defaults.sites`          | list/enum | `"all"`                    | Sites to poll                           |
| `services.unpoller.unifi.defaults.save_ids`       | bool      | `false`                    | Collect IDS data (Loki/InfluxDB)        |
| `services.unpoller.unifi.defaults.save_events`    | bool      | `false`                    | Collect UniFi events (Loki/InfluxDB)    |
| `services.unpoller.unifi.defaults.save_alarms`    | bool      | `false`                    | Collect UniFi alarms (Loki/InfluxDB)    |
| `services.unpoller.unifi.defaults.save_anomalies` | bool      | `false`                    | Collect UniFi anomalies (Loki/InfluxDB) |
| `services.unpoller.unifi.defaults.save_dpi`       | bool      | `false`                    | Collect deep packet inspection data     |
| `services.unpoller.unifi.defaults.verify_ssl`     | bool      | `true`                     | Verify controller TLS cert              |

**Important:** The `pass` option takes a _file path_, and the module applies `file://` prefix automatically. Use a SOPS-provisioned secret file.

---

## Step 1: Create a UniFi Controller Read-Only User

Before deploying Unpoller, create a dedicated read-only local user on the UniFi controller:

1. Log into the UniFi controller web UI
2. Navigate to Settings → Admins & Users → Add Admin
3. Create a **local-only** user:
   - Username: `unpoller`
   - Role: **Read Only**
   - Do NOT give Super Admin access
4. Store the password in SOPS secrets (Step 2)

> **Note:** For UniFi OS devices (UDM, UDM Pro, UXG, CloudKey firmware 2.x+), do NOT include `:8443` in the URL. Use `https://<controller-ip>` directly.

---

## Step 2: Add SOPS Secret

**File:** `nix-config/secrets/augustus.yaml`

Add the Unpoller controller password:

```yaml
unpoller_password: <encrypted-password>
```

**File:** `nix-config/modules/_private/augustus/sops.nix`

Register the secret:

```nix
sops.secrets.unpoller_password = {
  owner = "unifi-poller";
  group = "unifi-poller";
  mode = "0400";
};
```

---

## Step 3: Register in Service Registry

**File:** `nix-config/modules/service-registry.nix`

Add to `config.constants.services`:

```nix
unpoller = {
  port = 9130;
};
```

Port 9130 is the standard Unpoller/Prometheus exporter port.

---

## Step 4: Create the Service Module

**File:** `nix-config/modules/services/unpoller.nix`

```nix
{ config, ... }:
let
  c = config.constants;
  svc = c.services.unpoller;
  lokiSvc = c.services.loki;
in
{
  flake.modules.nixos.unpoller =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    {
      services.unpoller = {
        enable = true;

        # Poller settings
        poller = {
          debug = false;
          quiet = true;  # reduce log noise in production
        };

        # Disable InfluxDB (we use Prometheus + Loki)
        influxdb.disable = true;

        # Prometheus exporter — bind to localhost only
        prometheus = {
          disable = false;
          http_listen = "127.0.0.1:${toString svc.port}";
          report_errors = false;
        };

        # Loki output for events, alarms, anomalies, IDS
        loki = {
          url = "http://127.0.0.1:${toString lokiSvc.port}/loki/api/v1/push";
          interval = "2m";
          timeout = "10s";
        };

        # UniFi controller configuration
        unifi.defaults = {
          url = "https://192.168.1.1";  # TODO: replace with actual controller IP/hostname
          user = "unpoller";
          pass = config.sops.secrets.unpoller_password.path;
          sites = "all";
          verify_ssl = false;  # self-signed on most UniFi controllers
          save_sites = true;
          save_ids = true;
          save_events = true;
          save_alarms = true;
          save_anomalies = true;
          save_dpi = false;  # adds ~150 data points per client, enable if needed
        };
      };

      services.failure-notifs.attachServices = [ "unifi-poller" ];
    };
}
```

---

## Step 5: Add Prometheus Scrape Config

**File:** `nix-config/modules/services/prometheus.nix`

Add a new scrape job to `services.prometheus.scrapeConfigs`:

```nix
{
  job_name = "unpoller";
  static_configs = [
    { targets = [ "127.0.0.1:${toString c.services.unpoller.port}" ]; }
  ];
  metrics_path = "/metrics";
}
```

This tells Prometheus to scrape Unpoller's metrics endpoint every 15s (the global scrape interval).

---

## Step 6: Import Module into Augustus

**File:** `nix-config/modules/hosts/augustus.nix`

Add to the `modules` list:

```nix
nixos.unpoller
```

Place it near the other monitoring-related modules (after `nixos.prometheus`, `nixos.loki`, etc.).

---

## Step 7: Update Port Assignments

**File:** `docs/port-assignments.md`

Add to the Augustus table:

```
| 9130  | Unpoller (Prometheus)  | TCP      | 127.0.0.1                | UniFi metrics exporter                  |
```

---

## Loki Integration Details

Unpoller natively pushes events to Loki when `loki.url` is configured. The data includes:

- **Events** (`save_events`): Device connects/disconnects, config changes, firmware updates
- **Alarms** (`save_alarms`): Connectivity loss, rogue APs, DNS issues
- **Anomalies** (`save_anomalies`): Unusual traffic patterns
- **IDS** (`save_ids`): Intrusion detection system alerts

These are pushed every `loki.interval` (2m default) directly to the Loki push API. No additional Alloy/Promtail configuration is needed — Unpoller handles the push itself.

### Loki Labels

Unpoller adds labels to log entries including:

- `app=unpoller`
- `controller=<url>`
- `site_name=<site>`
- `event_type=<type>` (for events)

---

## Prometheus Metrics

Unpoller exposes metrics under the `unifipoller` namespace (configurable). Key metric families:

| Metric Prefix                 | Description                                    |
| ----------------------------- | ---------------------------------------------- |
| `unifipoller_device_*`        | Per-device stats (uptime, temperature, load)   |
| `unifipoller_client_*`        | Per-client stats (bytes, signal, satisfaction) |
| `unifipoller_uap_*`           | Access point metrics (channels, clients)       |
| `unifipoller_usw_*`           | Switch metrics (port stats, PoE)               |
| `unifipoller_usg_*` / `udm_*` | Gateway/router metrics (WAN, firewall, VPN)    |
| `unifipoller_site_*`          | Site-level aggregate metrics                   |
| `unifipoller_subsystem_*`     | Unpoller internal health metrics               |

---

## Grafana Dashboards

The Unpoller project provides pre-built Grafana dashboards. After deployment, import them from Grafana.com:

| Dashboard                  | Grafana ID | Data Source |
| -------------------------- | ---------- | ----------- |
| Network Sites              | 11311      | Prometheus  |
| USW: Switch Insights       | 11312      | Prometheus  |
| UAP: Access Point Insights | 11314      | Prometheus  |
| Client Insights            | 11315      | Prometheus  |
| USG/UDM: Gateway Insights  | 11313      | Prometheus  |
| Network: DPI               | 11310      | Prometheus  |

Import these via Grafana UI → Dashboards → Import → enter the dashboard ID.

---

## Security Considerations

- Unpoller runs as a dedicated `unifi-poller` system user (created by the NixOS module)
- The controller password is stored in SOPS and mounted as a file readable only by the service user
- Prometheus exporter binds to `127.0.0.1` only — no external access
- Loki push is to localhost only
- No Caddy vhost is needed (no external access to Unpoller itself)
- The service has `ProtectHome=true`, `ProtectSystem=full`, `NoNewPrivileges=true`, `DevicePolicy=closed`

---

## Checklist

- [ ] Create read-only `unpoller` user on UniFi controller
- [ ] Add `unpoller_password` to `nix-config/secrets/augustus.yaml`
- [ ] Register secret in `nix-config/modules/_private/augustus/sops.nix`
- [ ] Add `unpoller` to `service-registry.nix` (port 9130)
- [ ] Create `nix-config/modules/services/unpoller.nix`
- [ ] Add Prometheus scrape job for `unpoller` in `prometheus.nix`
- [ ] Add `nixos.unpoller` to `nix-config/modules/hosts/augustus.nix`
- [ ] Update `docs/port-assignments.md` with port 9130
- [ ] Deploy and verify `systemctl status unifi-poller` on Augustus
- [ ] Verify metrics at `curl http://127.0.0.1:9130/metrics`
- [ ] Verify logs arriving in Loki (query: `{app="unpoller"}`)
- [ ] Import Grafana dashboards (IDs: 11310–11315)
- [ ] Verify dashboards populate with data

---

## Dependencies

| Dependency | Status      | Notes                                        |
| ---------- | ----------- | -------------------------------------------- |
| Prometheus | ✅ Deployed | Already scraping other targets on Augustus   |
| Loki       | ✅ Deployed | Already receiving logs from Alloy            |
| Grafana    | ✅ Deployed | Already running with Prometheus/Loki sources |
| SOPS       | ✅ Deployed | Already managing secrets on Augustus         |
| UniFi      | ✅ Running  | Controller must be reachable from Augustus   |

---

## Troubleshooting

- **"context deadline exceeded" in logs:** Increase `loki.timeout` (e.g. `"30s"`)
- **Empty metrics:** Verify the controller URL does NOT include `:8443` for UniFi OS devices
- **Auth failures:** Ensure the `unpoller` user is a _local_ admin (not SSO/cloud account)
- **SSL errors:** Set `verify_ssl = false` if using self-signed controller cert
- **No Loki data:** Confirm `save_events`, `save_alarms`, etc. are `true` — these are off by default
