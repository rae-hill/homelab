{ inputs, ... }:
{
  flake.modules.nixos.homelab-ui = {
    imports = with inputs.self.modules.nixos; [
      homelab-ui-catalog
    ];
  };
}
