{ inputs, config, ... }:
let
  darwin = inputs.self.modules.darwin;
in
{
  flake.darwinConfigurations.mini = inputs.nix-darwin.lib.darwinSystem {
    specialArgs = {
      inherit inputs;
    };
    modules = [
      inputs.sops-nix.darwinModules.sops
      inputs.nixvim.nixDarwinModules.nixvim

      darwin.darwin-base
      darwin.nixvim-complete
      darwin.homebrew
      darwin.homelab-service-apphost
      darwin.mini-jellyfin

      ./../_private/mini/sops.nix
      ./../_private/mini/programs.nix

      { networking.hostName = "mini"; }
    ];
  };
}
