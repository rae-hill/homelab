{ inputs, ... }:
{
  flake.modules.homeManager.rae = {
    imports = with inputs.self.modules.homeManager; [
      desktop-complete
      desktop-gnome-complete
      desktop-games-complete
      desktop-shell-complete
      rae-sops
    ];

    home.stateVersion = "24.05";

    home = {
      username = "rae";
      homeDirectory = "/home/rae";
    };
  };
}
