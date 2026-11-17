# planka — feature aggregate. Preserves the `nixos.planka` import name.
{ inputs, ... }:
{
  flake.modules.nixos.planka = {
    imports = with inputs.self.modules.nixos; [
      planka-catalog
      planka-service
    ];
  };
}
