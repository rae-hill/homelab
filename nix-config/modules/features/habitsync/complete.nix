# habitsync — feature aggregate. Preserves the `nixos.habitsync` import name.
{ inputs, ... }:
{
  flake.modules.nixos.habitsync = {
    imports = with inputs.self.modules.nixos; [
      habitsync-catalog
      habitsync-service
    ];
  };
}
