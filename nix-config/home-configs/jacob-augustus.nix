{ inputs, config, ... }:
let
  hm = inputs.self.modules.homeManager;
in
{
  flake.homeConfigurations."jacob@augustus" = inputs.home-manager.lib.homeManagerConfiguration {
    pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;
    extraSpecialArgs = {
      inherit inputs;
      pkgs-unstable = inputs.nixpkgs-unstable.legacyPackages.x86_64-linux;
    };
    modules = [
      inputs.catppuccin.homeModules.catppuccin
      inputs.nixvim.homeModules.nixvim

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

        programs.git = {
          enable = true;
          settings = {
            user = {
              name = "Jacob Alford";
              email = "github.scouting378@passmail.net";
              signingkey = "~/.ssh/id_ed25519";
            };
            init = {
              defaultBranch = "main";
            };
            pull = {
              rebase = true;
            };
            core = {
              editor = "nvim";
            };
            push = {
              autoSetupRemote = true;
            };
            gpg = {
              format = "ssh";
            };
            commit = {
              gpgsign = true;
            };
          };
        };

        systemd.user.startServices = "sd-switch";

        home.stateVersion = "25.05";
      })
    ];
  };
}
