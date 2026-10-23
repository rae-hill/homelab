# postgres — feature aggregate. Preserves the `nixos.postgres` import name.
{ inputs, ... }:
{
  flake.modules.nixos.postgres = {
    imports = with inputs.self.modules.nixos; [
      postgres-catalog
      postgres-service
    ];
  };
}
