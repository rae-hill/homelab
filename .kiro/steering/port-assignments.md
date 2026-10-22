# Port Assignments

## Reference Document

The canonical port assignment list lives at `./docs/port-assignments.md`. This document must be kept up to date whenever ports are added, removed, or changed.

## When to Update

Update `docs/port-assignments.md` when:

- Adding a new service with a listening port
- Changing a port in `service-registry.nix` or any service module
- Adding or modifying firewall rules in `_private/<host>/security.nix`
- Adding a new container with port mappings
- Adding a new ACME challenge port

## Where Ports Are Defined

| Source                                              | Purpose                                                 |
| --------------------------------------------------- | ------------------------------------------------------- |
| `nix-config/modules/service-registry.nix`           | Centralized port constants (most services)              |
| `nix-config/modules/services/*.nix`                 | Service-specific ports (exporters, internal gRPC, etc.) |
| `nix-config/modules/_private/<host>/security.nix`   | Firewall rules (which ports are externally accessible)  |
| `nix-config/modules/_private/<host>/programs.nix`   | Host-specific service configurations                    |
| `nix-config/modules/features/cicero-observability/` | Cicero-specific metrics/observability ports             |

## Conventions

- Application ports are defined in `service-registry.nix` under `config.constants.services.<name>.port`
- ACME challenge ports use `acmePort` in the same service constant block
- Internal-only services bind to `127.0.0.1`
- Services exposed over Tailscale are firewalled to the `tailscale0` interface
- Container ports map internal container ports to host ports (e.g. it-tools maps 8080→47309)
- Metrics ports follow the Prometheus convention (9xxx range) where possible

## Host ↔ Service Mapping

Which host runs which services is determined by the modules list in `nix-config/modules/hosts/<host>.nix`. Cross-reference that file with the port document when verifying assignments.
