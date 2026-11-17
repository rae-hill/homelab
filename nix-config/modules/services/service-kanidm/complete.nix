# kanidm — feature aggregate. Preserves the `nixos.kanidm` import name.
{ inputs, ... }:
{
  flake.modules.nixos.kanidm = {
    imports = with inputs.self.modules.nixos; [
      kanidm-catalog
      kanidm-service
    ];
  };
}
