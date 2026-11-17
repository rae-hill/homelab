{ inputs, ... }:
{
  flake.modules.nixos.cicero-observability = {
    imports = with inputs.self.modules.nixos; [
      cicero-observability-catalog
      cicero-observability-caddy-host
      cicero-observability-node-exporter
      cicero-observability-alloy
    ];
  };
}
