# Port Assignments

This document tracks all port assignments across homelab hosts to prevent conflicts.

Last updated: 2026-07-14

---

## Augustus (Primary Server)

| Port  | Service                | Protocol | Bind Address             | Notes                                   |
| ----- | ---------------------- | -------- | ------------------------ | --------------------------------------- |
| 22    | OpenSSH                | TCP      | tailscale0 only          | Firewall: tailscale0 interface          |
| 80    | Caddy                  | TCP      | 0.0.0.0                  | HTTP (ACME challenges, redirects)       |
| 443   | Caddy                  | TCP      | 0.0.0.0                  | HTTPS reverse proxy                     |
| 1337  | Planka                 | TCP      | 127.0.0.1 (host network) | Project management (behind Caddy)       |
| 1812  | RADIUS (radiusd)       | TCP/UDP  | 0.0.0.0                  | 802.1X authentication                   |
| 1813  | RADIUS accounting      | TCP/UDP  | 0.0.0.0                  | RADIUS accounting                       |
| 2019  | Caddy metrics          | TCP      | 127.0.0.1                | Scraped by Prometheus                   |
| 3000  | Grafana                | TCP      | 127.0.0.1                | Dashboards (behind Caddy)               |
| 3100  | Loki                   | TCP      | 127.0.0.1                | Log aggregation                         |
| 3200  | Tempo (HTTP)           | TCP      | 127.0.0.1                | Distributed tracing                     |
| 4317  | Tempo (gRPC OTLP)      | TCP      | 127.0.0.1                | OpenTelemetry trace ingestion           |
| 5201  | iperf3                 | TCP      | 0.0.0.0                  | Network speed testing                   |
| 5252  | Tailscale metrics      | TCP      | tailscale0 only          | Prometheus scrape target                |
| 5432  | PostgreSQL             | TCP      | 0.0.0.0 (mTLS)           | Database; tailscale0 firewall + mTLS    |
| 6842  | HabitSync              | TCP      | 127.0.0.1 (host network) | Habit tracker (behind Caddy)            |
| 8123  | Home Assistant         | TCP      | 127.0.0.1                | Smart home (behind Caddy)               |
| 8443  | Kanidm                 | TCP      | 127.0.0.1                | Identity management (behind Caddy)      |
| 9090  | Prometheus             | TCP      | 127.0.0.1                | Metrics (behind Caddy with mTLS)        |
| 9095  | Tempo (gRPC server)    | TCP      | 127.0.0.1                | Internal Tempo gRPC                     |
| 9096  | Loki (gRPC)            | TCP      | 127.0.0.1                | Internal Loki gRPC                      |
| 9100  | Node Exporter          | TCP      | 127.0.0.1                | System metrics for Prometheus           |
| 9130  | Unpoller (Prometheus)  | TCP      | 127.0.0.1                | UniFi metrics exporter                  |
| 9187  | Postgres Exporter      | TCP      | 127.0.0.1                | PostgreSQL metrics for Prometheus       |
| 12345 | Alloy                  | TCP      | 127.0.0.1                | Log shipper admin UI                    |
| 19553 | Open WebUI             | TCP      | 127.0.0.1                | AI chat interface (behind Caddy)        |
| 22378 | RADIUS ACME            | TCP      | 127.0.0.1                | ACME http-01 for radius cert            |
| 22480 | Prometheus client ACME | TCP      | 127.0.0.1                | ACME http-01 for prometheus client cert |
| 25565 | Minecraft              | TCP      | 0.0.0.0 (tailscale0)     | Fabric server; firewall: tailscale0     |
| 35427 | Homelab API            | TCP      | 127.0.0.1                | Node.js API server (behind Caddy)       |
| 41872 | PostgreSQL ACME        | TCP      | 127.0.0.1                | ACME http-01 for postgres cert          |
| 47309 | IT Tools               | TCP      | 127.0.0.1                | Developer tools (behind Caddy)          |
| 51571 | Apprise                | TCP      | 127.0.0.1                | Notification gateway (behind Caddy)     |
| 64073 | Kanidm ACME            | TCP      | 127.0.0.1                | ACME http-01 for kanidm cert            |

---

## Cicero (Certificate Authority)

| Port  | Service               | Protocol | Bind Address    | Notes                                       |
| ----- | --------------------- | -------- | --------------- | ------------------------------------------- |
| 22    | OpenSSH               | TCP      | 0.0.0.0         | Also open on tailscale0                     |
| 80    | Caddy                 | TCP      | tailscale0 only | ACME challenges                             |
| 443   | step-ca               | TCP      | 0.0.0.0         | Certificate authority; tailscale0 firewall  |
| 5252  | Tailscale metrics     | TCP      | tailscale0 only | Prometheus scrape target                    |
| 8443  | Caddy (HTTPS)         | TCP      | tailscale0 only | mTLS metrics proxy (node-exporter, step-ca) |
| 9100  | Node Exporter         | TCP      | 127.0.0.1       | System metrics (behind mTLS Caddy)          |
| 10000 | step-ca OIDC listener | TCP      | 127.0.0.1       | OIDC provisioner callback                   |
| 12345 | Alloy                 | TCP      | 127.0.0.1       | Log shipper admin UI                        |
| 22479 | Cicero metrics ACME   | TCP      | 127.0.0.1       | ACME http-01 for Alloy client cert          |
| 43379 | step-ca metrics       | TCP      | 127.0.0.1       | Internal metrics (behind mTLS Caddy)        |

---

## Praeconinus (Public-Facing Server)

| Port  | Service           | Protocol | Bind Address    | Notes                               |
| ----- | ----------------- | -------- | --------------- | ----------------------------------- |
| 22    | OpenSSH           | TCP      | tailscale0 only | SSH access                          |
| 443   | Caddy             | TCP      | 0.0.0.0         | Public HTTPS                        |
| 5252  | Tailscale metrics | TCP      | tailscale0 only | Prometheus scrape target            |
| 8443  | Caddy (Tailscale) | TCP      | tailscale0 only | Homelab API+UI via Tailscale domain |
| 35427 | Homelab API       | TCP      | 127.0.0.1       | Node.js API server (behind Caddy)   |

---

## Nixos (Workstation)

| Port  | Service               | Protocol | Bind Address    | Notes                             |
| ----- | --------------------- | -------- | --------------- | --------------------------------- |
| 22    | OpenSSH               | TCP      | tailscale0 only | SSH access                        |
| 5252  | Tailscale metrics     | TCP      | tailscale0 only | Prometheus scrape target          |
| 5353  | Avahi (mDNS)          | UDP      | 0.0.0.0         | AirPlay/UxPlay discovery          |
| 10200 | Wyoming Piper (TTS)   | TCP      | 0.0.0.0         | Text-to-speech for Home Assistant |
| 10300 | Wyoming Whisper (STT) | TCP      | 0.0.0.0         | Speech-to-text for Home Assistant |
| 11434 | Ollama                | TCP      | 0.0.0.0         | LLM inference (openFirewall)      |
| 49545 | UxPlay                | TCP/UDP  | 0.0.0.0         | AirPlay mirroring                 |
| 56503 | UxPlay                | TCP/UDP  | 0.0.0.0         | AirPlay mirroring                 |
| 58042 | UxPlay                | TCP/UDP  | 0.0.0.0         | AirPlay mirroring                 |

---

## Mini (Mac Mini - nix-darwin)

| Port | Service           | Protocol | Bind Address    | Notes                       |
| ---- | ----------------- | -------- | --------------- | --------------------------- |
| 443  | Caddy             | TCP      | 0.0.0.0         | HTTPS reverse proxy         |
| 5252 | Tailscale metrics | TCP      | tailscale0 only | Prometheus scrape target    |
| 8096 | Jellyfin          | TCP      | localhost       | Media server (behind Caddy) |

---

## All Hosts (Cross-Cutting)

| Port | Service           | Protocol | Bind Address    | Notes                           |
| ---- | ----------------- | -------- | --------------- | ------------------------------- |
| 5252 | Tailscale metrics | TCP      | tailscale0 only | Prometheus scrape via Tailscale |

---

## Port Ranges & Conventions

- **Well-known ports (1–1023):** Standard services (SSH, HTTP/S, RADIUS)
- **ACME challenge ports:** High ports on 127.0.0.1, used by `security.acme.certs.*.listenHTTP`
- **Application ports:** Defined in `service-registry.nix` under `config.constants.services`
- **Metrics ports:** Typically 9xxx range (Prometheus convention)
- **Container internal ports:** Mapped from container port to host port (e.g. apprise 8000→51571, it-tools 8080→47309)

## Adding a New Port

1. Choose a port not already in use on the target host(s)
2. Add it to `nix-config/modules/service-registry.nix` if it's a shared constant
3. Update the firewall rules in the host's `_private/<host>/security.nix` if the port should be externally accessible
4. Update this document with the new assignment
