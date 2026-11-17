{ inputs, ... }:
let
  hm = inputs.self.modules.homeManager;
in
{
  # NixOS
  flake.homeConfigurations.rae = inputs.home-manager.lib.homeManagerConfiguration {
    pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;

    extraSpecialArgs = {
      inherit inputs;
      pkgs-unstable = import inputs.nixpkgs-unstable {
        system = "x86_64-linux";
        config.allowUnfree = true;
      };
    };

    modules = [
      inputs.sops-nix.homeManagerModules.sops

      hm.rae
    ];
  };
}
