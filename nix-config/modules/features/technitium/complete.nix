{ inputs, ... }:
{
  flake.modules.nixos.technitium = {
    imports = with inputs.self.modules.nixos; [
      technitium-service
      technitium-acme
      technitium-caddy
      technitium-provision
      technitium-alloy
      technitium-node-exporter
    ];
  };
}
