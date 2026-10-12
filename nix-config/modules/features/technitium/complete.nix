{ inputs, ... }:
{
  # Generic, reusable Technitium DNS server feature. Option-driven via
  # services.technitium-server-complete (see technitium-options). Host-specific
  # wiring (ACME certs, observability, option values) lives in a consuming layer
  # such as technitium-aedilis.
  flake.modules.nixos.technitium = {
    imports = with inputs.self.modules.nixos; [
      technitium-options
      technitium-service
      technitium-provision
      technitium-caddy
    ];
  };
}
