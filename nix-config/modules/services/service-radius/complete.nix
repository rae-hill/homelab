# radius — feature aggregate. Preserves the `nixos.radius` import name.
{ inputs, ... }:
{
  flake.modules.nixos.radius = {
    imports = with inputs.self.modules.nixos; [
      radius-catalog
      radius-service
    ];
  };
}
