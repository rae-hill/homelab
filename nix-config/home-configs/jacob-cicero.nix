{ inputs, config, ... }:
let
  hm = inputs.self.modules.homeManager;
in
{
  flake.homeConfigurations."jacob@cicero" = inputs.home-manager.lib.homeManagerConfiguration {
    pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;
    extraSpecialArgs = {
      inherit inputs;
      pkgs-unstable = inputs.nixpkgs-unstable.legacyPackages.x86_64-linux;
    };
    modules = [
      inputs.catppuccin.homeModules.catppuccin
      inputs.nixvim.homeModules.nixvim

      hm.git
      hm.nixvim-complete
      hm.zsh

      ({ inputs, lib, config, pkgs, pkgs-unstable, ... }: {
        nixpkgs = {
          overlays = [ ];
          config = {
            allowUnfree = true;
            allowUnfreePredicate = _: true;
          };
        };

        home = {
          username = "jacob";
          homeDirectory = "/home/jacob";
        };

        home.packages = with pkgs; [
          yubikey-manager
          httpie
        ];

        programs.home-manager.enable = true;

        programs.starship = {
          enable = true;
          enableZshIntegration = true;
        };

        systemd.user.startServices = "sd-switch";

        home.stateVersion = "25.11";
      })
    ];
  };
}
