---
name: port-assignments
description: Port assignment conventions and the requirement to keep docs/port-assignments.md up to date. Use when adding or changing service ports, service-registry.nix entries, firewall rules in system-configs/<host>/security.nix, container port mappings, or ACME challenge ports.
---

# Port Assignments

## Reference Document

The canonical port assignment list lives at `./docs/port-assignments.md`. This document must be kept up to date whenever ports are added, removed, or changed.

## When to Update

Update `docs/port-assignments.md` when:

- Adding a new service with a listening port
- Changing a port in `service-registry.nix` or any service module
- Adding or modifying firewall rules in `system-configs/<host>/security.nix`
- Adding a new container with port mappings
- Adding a new ACME challenge port

## Where Ports Are Defined

| Source                                                                         | Purpose                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `nix-config/service-registry.nix`                                              | Centralized port constants (most services)              |
| `nix-config/modules/{networking,observability,apps,ai,homelab,identity,data}/` | Service-specific ports (exporters, internal gRPC, etc.) |
| `nix-config/system-configs/<host>/security.nix`                                | Firewall rules (which ports are externally accessible)  |
| `nix-config/system-configs/<host>/programs.nix`                                | Host-specific service configurations                    |
| `nix-config/system-configs/cicero/observability/`                              | Cicero-specific metrics/observability ports             |

## Conventions

- Application ports are defined in `service-registry.nix` under `config.constants.services.<name>.port`
- ACME challenge ports use `acmePort` in the same service constant block
- Internal-only services bind to `127.0.0.1`
- Services exposed over Tailscale are firewalled to the `tailscale0` interface
- Container ports map internal container ports to host ports (e.g. it-tools maps 8080→47309)
- Metrics ports follow the Prometheus convention (9xxx range) where possible

## Host ↔ Service Mapping

Which host runs which services is determined by the modules list in `nix-config/system-configs/<host>/default.nix`. Cross-reference that file with the port document when verifying assignments.
