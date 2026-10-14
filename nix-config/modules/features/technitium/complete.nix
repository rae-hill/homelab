{ inputs, ... }:
{
  # Generic, reusable Technitium DNS server feature. Option-driven via
  # services.technitium-server-complete (see technitium-options). This feature is
  # SERVER-ONLY (service + caddy). API-driven provisioning lives in the separate
  # `technitium-provisioning` feature, imported explicitly by hosts that need it.
  # Host-specific wiring (ACME certs, observability, option values) lives in a
  # consuming layer such as technitium-aedilis.
  flake.modules.nixos.technitium = {
    imports = with inputs.self.modules.nixos; [
      technitium-options
      technitium-service
      technitium-caddy
    ];
  };
}
