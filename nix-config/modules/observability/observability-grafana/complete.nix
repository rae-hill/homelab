# grafana — feature aggregate. Preserves the `nixos.grafana` import name.
{ inputs, ... }:
{
  flake.modules.nixos.grafana = {
    imports = with inputs.self.modules.nixos; [
      grafana-catalog
      grafana-service
    ];
  };
}
